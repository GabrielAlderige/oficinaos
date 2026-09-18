import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  FINANCIAL_DIRECTIONS,
  FINANCIAL_ENTRY_STATUSES,
  FINANCIAL_ORIGINS,
  PAYMENT_ENTRY_STATUSES,
  PAYMENT_METHODS,
} from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { customers } from './customers';
import { payments } from './payments';
import { purchaseOrders } from './purchases';
import { suppliers } from './suppliers';
import { organizations, users } from './tenancy';
import { workOrders } from './work-orders';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });

/**
 * Categorias do financeiro (docs/DATABASE.md §6, MVP 2, E13). As nove do
 * sistema nascem com a oficina; `system_key` diz qual é qual no código, porque
 * o nome a oficina pode renomear ("Aluguel" → "Aluguel do galpão").
 */
export const financialCategories = pgTable(
  'financial_categories',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    direction: text({ enum: FINANCIAL_DIRECTIONS }).notNull(),
    name: text().notNull(),
    systemKey: text(),
    ...timestamps,
  },
  (t) => [
    unique('financial_categories_org_id_unique').on(t.organizationId, t.id),
    uniqueIndex('financial_categories_org_name_unique').on(t.organizationId, t.direction, sql`lower(name)`),
    uniqueIndex('financial_categories_org_key_unique')
      .on(t.organizationId, t.systemKey)
      .where(sql`system_key is not null`),
    check('financial_categories_direction_check', sql`${t.direction} in (${list(FINANCIAL_DIRECTIONS)})`),
  ],
);

/**
 * Conta a receber e conta a pagar na MESMA tabela, separadas por `direction`
 * (DATABASE §3): o ciclo de vida é idêntico e o fluxo de caixa sai de uma
 * consulta, sem UNION. A interface continua com duas telas.
 *
 * `paid_cents` é CACHE, como o `paid_cents` da OS: sai sempre da soma das
 * baixas confirmadas (ou, no lançamento de uma OS, dos pagamentos daquela OS),
 * nunca de valor mandado pela tela.
 *
 * "Vencida" não é situação gravada — é `due_date < hoje` com saldo em aberto.
 * Guardar exigiria um job varrendo a tabela toda madrugada.
 */
export const financialEntries = pgTable(
  'financial_entries',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    direction: text({ enum: FINANCIAL_DIRECTIONS }).notNull(),
    status: text({ enum: FINANCIAL_ENTRY_STATUSES }).notNull().default('OPEN'),
    /** MANUAL, ou espelho de uma OS finalizada / de uma nota de compra recebida */
    origin: text({ enum: FINANCIAL_ORIGINS }).notNull().default('MANUAL'),
    categoryId: uuid(),
    description: text().notNull(),
    amountCents: money().notNull(),
    paidCents: money().notNull().default(0),
    dueDate: date({ mode: 'string' }).notNull(),
    customerId: uuid(),
    supplierId: uuid(),
    workOrderId: uuid(),
    purchaseOrderId: uuid(),
    /** parcelas do mesmo acordo compartilham o grupo: "2 de 3" */
    groupId: uuid(),
    installmentNumber: integer().notNull().default(1),
    installmentCount: integer().notNull().default(1),
    notes: text(),
    /** quando ficou quitado (para o "recebido no mês" sem varrer as baixas) */
    settledAt: timestamptz(),
    canceledAt: timestamptz(),
    canceledBy: uuid().references(() => users.id),
    cancelReason: text(),
    createdBy: uuid().references(() => users.id),
    version: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique('financial_entries_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'financial_entries_category_fk',
      columns: [t.organizationId, t.categoryId],
      foreignColumns: [financialCategories.organizationId, financialCategories.id],
    }),
    foreignKey({
      name: 'financial_entries_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    foreignKey({
      name: 'financial_entries_supplier_fk',
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    foreignKey({
      name: 'financial_entries_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'financial_entries_purchase_order_fk',
      columns: [t.organizationId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }),
    // a lista é sempre "desta direção, nesta situação, pelo vencimento"
    index('financial_entries_due_idx').on(t.organizationId, t.direction, t.status, t.dueDate),
    index('financial_entries_work_order_idx').on(t.organizationId, t.workOrderId),
    index('financial_entries_purchase_order_idx').on(t.organizationId, t.purchaseOrderId),
    index('financial_entries_customer_idx').on(t.organizationId, t.customerId, t.dueDate),
    index('financial_entries_supplier_idx').on(t.organizationId, t.supplierId, t.dueDate),
    check('financial_entries_direction_check', sql`${t.direction} in (${list(FINANCIAL_DIRECTIONS)})`),
    check('financial_entries_status_check', sql`${t.status} in (${list(FINANCIAL_ENTRY_STATUSES)})`),
    check('financial_entries_origin_check', sql`${t.origin} in (${list(FINANCIAL_ORIGINS)})`),
    check('financial_entries_amount_check', sql`${t.amountCents} > 0`),
    // não se recebe mais do que se cobrou: crédito a favor do cliente é V3
    check('financial_entries_paid_check', sql`${t.paidCents} >= 0 and ${t.paidCents} <= ${t.amountCents}`),
    check(
      'financial_entries_installment_check',
      sql`${t.installmentCount} >= 1 and ${t.installmentNumber} between 1 and ${t.installmentCount}`,
    ),
    // lançamento automático sempre aponta para o documento que o gerou
    check(
      'financial_entries_origin_document_check',
      sql`(${t.origin} <> 'WORK_ORDER' or ${t.workOrderId} is not null) and (${t.origin} <> 'PURCHASE' or ${t.purchaseOrderId} is not null)`,
    ),
    check(
      'financial_entries_canceled_check',
      sql`(${t.status} = 'CANCELED') = (${t.canceledAt} is not null) and (${t.canceledAt} is null or ${t.cancelReason} is not null)`,
    ),
  ],
);

/**
 * A baixa: o dinheiro que entrou (ou saiu) por causa de um lançamento.
 *
 * Baixa **nunca é apagada** — erro vira `CANCELED` com motivo, como o
 * pagamento da E7. Quando o lançamento é de uma OS, quem guarda o dinheiro
 * continua sendo `payments` (a verdade do caixa da OS), e a baixa só aponta
 * para ele por `payment_id`: uma entrada, duas leituras, zero divergência.
 */
export const financialSettlements = pgTable(
  'financial_settlements',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    entryId: uuid().notNull(),
    /** gerado pela tela: clique duplo, ou rede que repete o POST, não dá baixa duas vezes */
    clientRequestId: uuid().notNull(),
    amountCents: money().notNull(),
    method: text({ enum: PAYMENT_METHODS }).notNull(),
    paidAt: timestamptz().notNull().defaultNow(),
    notes: text(),
    status: text({ enum: PAYMENT_ENTRY_STATUSES }).notNull().default('CONFIRMED'),
    paymentId: uuid().references(() => payments.id),
    canceledAt: timestamptz(),
    canceledBy: uuid().references(() => users.id),
    cancelReason: text(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('financial_settlements_org_id_unique').on(t.organizationId, t.id),
    unique('financial_settlements_client_request_unique').on(t.organizationId, t.clientRequestId),
    foreignKey({
      name: 'financial_settlements_entry_fk',
      columns: [t.organizationId, t.entryId],
      foreignColumns: [financialEntries.organizationId, financialEntries.id],
    }),
    index('financial_settlements_entry_idx').on(t.organizationId, t.entryId, t.paidAt),
    // o fluxo de caixa lê por data de pagamento
    index('financial_settlements_paid_idx').on(t.organizationId, t.paidAt),
    check('financial_settlements_method_check', sql`${t.method} in (${list(PAYMENT_METHODS)})`),
    check('financial_settlements_status_check', sql`${t.status} in (${list(PAYMENT_ENTRY_STATUSES)})`),
    check('financial_settlements_amount_check', sql`${t.amountCents} > 0`),
    check(
      'financial_settlements_canceled_check',
      sql`(${t.status} = 'CANCELED') = (${t.canceledAt} is not null) and (${t.canceledAt} is null or ${t.cancelReason} is not null)`,
    ),
  ],
);
