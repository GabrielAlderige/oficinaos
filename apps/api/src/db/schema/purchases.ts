import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, integer, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { PURCHASE_ORDER_STATUSES } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { inventoryMovements, parts } from './catalog';
import { supplierQuoteAwards, supplierQuoteRequests } from './supplier-quotes';
import { suppliers } from './suppliers';
import { organizations, users } from './tenancy';
import { workOrderItems } from './work-orders';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });
const quantity = () => numeric({ precision: 12, scale: 3 });

/**
 * O pedido de compra (docs/DATABASE.md §6, MVP 2, E12). Nasce em rascunho — à
 * mão, ou das ofertas escolhidas numa cotação da E11 — e congela quando é
 * marcado como pedido ao fornecedor.
 *
 * `received_quantity`/`returned_quantity` nas linhas são o resumo dos
 * recebimentos e devoluções, atualizados na MESMA transação com o pedido
 * travado; a prova de cada entrada está em `purchase_receipts` (append-only).
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    number: integer().notNull(),
    supplierId: uuid().notNull(),
    status: text({ enum: PURCHASE_ORDER_STATUSES }).notNull().default('DRAFT'),
    /** de que cotação saiu, quando saiu de uma */
    supplierQuoteRequestId: uuid(),
    /** previsão de chegada combinada com o fornecedor */
    expectedOn: date({ mode: 'string' }),
    /** frete combinado; o que entra no custo é o frete de cada recebimento */
    shippingCents: money().notNull().default(0),
    notes: text(),
    orderedAt: timestamptz(),
    orderedBy: uuid().references(() => users.id),
    receivedAt: timestamptz(),
    /** "encerrar o que falta": o fornecedor não vai mandar o resto */
    closedShortAt: timestamptz(),
    closeReason: text(),
    canceledAt: timestamptz(),
    canceledBy: uuid().references(() => users.id),
    cancelReason: text(),
    createdBy: uuid().references(() => users.id),
    version: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique('purchase_orders_org_id_unique').on(t.organizationId, t.id),
    unique('purchase_orders_org_number_unique').on(t.organizationId, t.number),
    foreignKey({
      name: 'purchase_orders_supplier_fk',
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    foreignKey({
      name: 'purchase_orders_quote_request_fk',
      columns: [t.organizationId, t.supplierQuoteRequestId],
      foreignColumns: [supplierQuoteRequests.organizationId, supplierQuoteRequests.id],
    }),
    index('purchase_orders_status_idx').on(t.organizationId, t.status, t.createdAt.desc()),
    index('purchase_orders_supplier_idx').on(t.organizationId, t.supplierId, t.createdAt.desc()),
    check('purchase_orders_status_check', sql`${t.status} in (${list(PURCHASE_ORDER_STATUSES)})`),
    check('purchase_orders_shipping_check', sql`${t.shippingCents} >= 0`),
    // fora do rascunho (e do cancelado direto do rascunho), o pedido foi feito em algum momento
    check(
      'purchase_orders_ordered_check',
      sql`${t.status} in ('DRAFT', 'CANCELED') or ${t.orderedAt} is not null`,
    ),
    check(
      'purchase_orders_canceled_check',
      sql`(${t.status} = 'CANCELED') = (${t.canceledAt} is not null) and (${t.canceledAt} is null or ${t.cancelReason} is not null)`,
    ),
    check('purchase_orders_close_reason_check', sql`${t.closedShortAt} is null or ${t.closeReason} is not null`),
  ],
);

export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    purchaseOrderId: uuid().notNull(),
    /** compra no sistema é de peça cadastrada: é ela que tem estoque e custo médio */
    partId: uuid().notNull(),
    /** a peça é para esta OS: ao chegar, é reservada para ela */
    workOrderItemId: uuid(),
    /** saiu desta escolha da cotação (E11) */
    supplierQuoteAwardId: uuid(),
    description: text().notNull(),
    partCode: text(),
    quantity: quantity().notNull(),
    unitCostCents: money().notNull(),
    receivedQuantity: quantity().notNull().default('0'),
    returnedQuantity: quantity().notNull().default('0'),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('purchase_order_items_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'purchase_order_items_order_fk',
      columns: [t.organizationId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }),
    foreignKey({
      name: 'purchase_order_items_part_fk',
      columns: [t.organizationId, t.partId],
      foreignColumns: [parts.organizationId, parts.id],
    }),
    foreignKey({
      name: 'purchase_order_items_work_order_item_fk',
      columns: [t.organizationId, t.workOrderItemId],
      foreignColumns: [workOrderItems.organizationId, workOrderItems.id],
    }),
    foreignKey({
      name: 'purchase_order_items_award_fk',
      columns: [t.organizationId, t.supplierQuoteAwardId],
      foreignColumns: [supplierQuoteAwards.organizationId, supplierQuoteAwards.id],
    }),
    index('purchase_order_items_order_idx').on(t.organizationId, t.purchaseOrderId, t.position),
    index('purchase_order_items_work_order_item_idx').on(t.organizationId, t.workOrderItemId),
    index('purchase_order_items_part_idx').on(t.organizationId, t.partId),
    check('purchase_order_items_quantity_check', sql`${t.quantity} > 0`),
    check('purchase_order_items_cost_check', sql`${t.unitCostCents} >= 0`),
    // nunca fica mais peça do que foi pedido, nem volta mais do que chegou. É o
    // LÍQUIDO (recebido − devolvido) que não passa do pedido: a peça errada volta
    // e a certa ainda pode chegar no lugar dela
    check(
      'purchase_order_items_received_check',
      sql`${t.receivedQuantity} >= 0 and ${t.receivedQuantity} - ${t.returnedQuantity} <= ${t.quantity}`,
    ),
    check(
      'purchase_order_items_returned_check',
      sql`${t.returnedQuantity} >= 0 and ${t.returnedQuantity} <= ${t.receivedQuantity}`,
    ),
  ],
);

/**
 * Cada chegada de mercadoria. APPEND-ONLY: é a prova do que entrou no estoque,
 * com que nota e por quem. Errou? Devolve ao fornecedor (decisão de 14/09/2026).
 *
 * `client_request_id` é gerado pela tela: clique duplo, ou rede que repete o
 * POST, não dá entrada duas vezes.
 */
export const purchaseReceipts = pgTable(
  'purchase_receipts',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    purchaseOrderId: uuid().notNull(),
    clientRequestId: uuid().notNull(),
    invoiceNumber: text(),
    /** frete desta entrega, rateado no custo das linhas recebidas */
    shippingCents: money().notNull().default(0),
    notes: text(),
    receivedBy: uuid()
      .notNull()
      .references(() => users.id),
    receivedAt: timestamptz().notNull().defaultNow(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('purchase_receipts_org_id_unique').on(t.organizationId, t.id),
    unique('purchase_receipts_client_request_unique').on(t.organizationId, t.clientRequestId),
    foreignKey({
      name: 'purchase_receipts_order_fk',
      columns: [t.organizationId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }),
    index('purchase_receipts_order_idx').on(t.organizationId, t.purchaseOrderId, t.receivedAt),
    check('purchase_receipts_shipping_check', sql`${t.shippingCents} >= 0`),
  ],
);

export const purchaseReceiptItems = pgTable(
  'purchase_receipt_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    receiptId: uuid().notNull(),
    purchaseOrderItemId: uuid().notNull(),
    quantity: quantity().notNull(),
    /** preço da nota, sem frete — é o que vai para o histórico de preço */
    unitCostCents: money().notNull(),
    freightCents: money().notNull().default(0),
    /** preço + frete por unidade: o que entrou no custo médio */
    landedUnitCostCents: money().notNull(),
    /** null para peça que não controla estoque */
    inventoryMovementId: uuid(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'purchase_receipt_items_receipt_fk',
      columns: [t.organizationId, t.receiptId],
      foreignColumns: [purchaseReceipts.organizationId, purchaseReceipts.id],
    }),
    foreignKey({
      name: 'purchase_receipt_items_order_item_fk',
      columns: [t.organizationId, t.purchaseOrderItemId],
      foreignColumns: [purchaseOrderItems.organizationId, purchaseOrderItems.id],
    }),
    foreignKey({
      name: 'purchase_receipt_items_movement_fk',
      columns: [t.inventoryMovementId],
      foreignColumns: [inventoryMovements.id],
    }),
    index('purchase_receipt_items_receipt_idx').on(t.organizationId, t.receiptId),
    check('purchase_receipt_items_quantity_check', sql`${t.quantity} > 0`),
    check(
      'purchase_receipt_items_cost_check',
      sql`${t.unitCostCents} >= 0 and ${t.freightCents} >= 0 and ${t.landedUnitCostCents} >= 0`,
    ),
  ],
);

/** Devolução ao fornecedor: a correção de um recebimento. APPEND-ONLY. */
export const purchaseReturns = pgTable(
  'purchase_returns',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    purchaseOrderId: uuid().notNull(),
    clientRequestId: uuid().notNull(),
    reason: text().notNull(),
    returnedBy: uuid()
      .notNull()
      .references(() => users.id),
    returnedAt: timestamptz().notNull().defaultNow(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('purchase_returns_org_id_unique').on(t.organizationId, t.id),
    unique('purchase_returns_client_request_unique').on(t.organizationId, t.clientRequestId),
    foreignKey({
      name: 'purchase_returns_order_fk',
      columns: [t.organizationId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }),
    index('purchase_returns_order_idx').on(t.organizationId, t.purchaseOrderId, t.returnedAt),
    check('purchase_returns_reason_check', sql`length(trim(${t.reason})) >= 3`),
  ],
);

export const purchaseReturnItems = pgTable(
  'purchase_return_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    returnId: uuid().notNull(),
    purchaseOrderItemId: uuid().notNull(),
    quantity: quantity().notNull(),
    /** o custo pelo qual saiu: o de entrada daquela compra */
    unitCostCents: money().notNull(),
    inventoryMovementId: uuid(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'purchase_return_items_return_fk',
      columns: [t.organizationId, t.returnId],
      foreignColumns: [purchaseReturns.organizationId, purchaseReturns.id],
    }),
    foreignKey({
      name: 'purchase_return_items_order_item_fk',
      columns: [t.organizationId, t.purchaseOrderItemId],
      foreignColumns: [purchaseOrderItems.organizationId, purchaseOrderItems.id],
    }),
    foreignKey({
      name: 'purchase_return_items_movement_fk',
      columns: [t.inventoryMovementId],
      foreignColumns: [inventoryMovements.id],
    }),
    index('purchase_return_items_return_idx').on(t.organizationId, t.returnId),
    check('purchase_return_items_quantity_check', sql`${t.quantity} > 0`),
    check('purchase_return_items_cost_check', sql`${t.unitCostCents} >= 0`),
  ],
);
