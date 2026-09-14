import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  OFFER_AVAILABILITIES,
  PRICE_SOURCES,
  SUPPLIER_QUOTE_STATUSES,
  type VehicleForSupplier,
} from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { parts } from './catalog';
import { suppliers } from './suppliers';
import { organizations, users } from './tenancy';
import { workOrderItems, workOrders } from './work-orders';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });
const quantity = () => numeric({ precision: 12, scale: 3 });

/**
 * A cotação com fornecedores (docs/DATABASE.md §6, MVP 2, E11).
 *
 * Congela ao ser criada: `content_hash` cobre itens, veículo, mensagem e prazo,
 * e a resposta do fornecedor carrega o hash do que ele viu. Mudar a cotação é
 * cancelar e fazer outra.
 *
 * `vehicle` já é o veículo COMO O FORNECEDOR VÊ (`vehicleForSupplier`): sem
 * placa, e com chassi só se `include_vin`. Guardar a versão filtrada, e não a
 * completa, é o que garante que nenhuma rota pública consiga devolver a placa —
 * ela simplesmente não está aqui.
 */
export const supplierQuoteRequests = pgTable(
  'supplier_quote_requests',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    number: integer().notNull(),
    /** anulável: cotação de reposição de estoque, sem OS, fica para a E12 */
    workOrderId: uuid(),
    status: text({ enum: SUPPLIER_QUOTE_STATUSES }).notNull().default('OPEN'),
    vehicle: jsonb().$type<VehicleForSupplier>(),
    includeVin: boolean().notNull().default(false),
    message: text(),
    contentHash: text().notNull(),
    expiresAt: timestamptz().notNull(),
    closedAt: timestamptz(),
    canceledAt: timestamptz(),
    cancelReason: text(),
    createdBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('supplier_quote_requests_org_id_unique').on(t.organizationId, t.id),
    unique('supplier_quote_requests_org_number_unique').on(t.organizationId, t.number),
    foreignKey({
      name: 'supplier_quote_requests_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    index('supplier_quote_requests_work_order_idx').on(t.organizationId, t.workOrderId, t.createdAt.desc()),
    index('supplier_quote_requests_status_idx').on(t.organizationId, t.status, t.createdAt.desc()),
    check('supplier_quote_requests_status_check', sql`${t.status} in (${list(SUPPLIER_QUOTE_STATUSES)})`),
    check('supplier_quote_requests_hash_check', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('supplier_quote_requests_cancel_reason_check', sql`${t.canceledAt} is null or ${t.cancelReason} is not null`),
    check(
      'supplier_quote_requests_canceled_consistency_check',
      sql`${t.status} <> 'CANCELED' or ${t.canceledAt} is not null`,
    ),
    // placa nunca: se um dia alguém gravar o veículo completo aqui, o banco recusa
    check('supplier_quote_requests_no_plate_check', sql`${t.vehicle} is null or not (${t.vehicle} ? 'plate')`),
    // chassi só com a marcação da oficina
    check(
      'supplier_quote_requests_vin_check',
      sql`${t.includeVin} or ${t.vehicle} is null or coalesce(${t.vehicle}->>'vin', '') = ''`,
    ),
  ],
);

/** As peças pedidas, copiadas do item da OS no momento do envio. */
export const supplierQuoteRequestItems = pgTable(
  'supplier_quote_request_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    requestId: uuid().notNull(),
    workOrderItemId: uuid(),
    partId: uuid(),
    description: text().notNull(),
    partCode: text(),
    brand: text(),
    quantity: quantity().notNull(),
    unit: text().notNull().default('UN'),
    position: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('supplier_quote_request_items_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'supplier_quote_request_items_request_fk',
      columns: [t.organizationId, t.requestId],
      foreignColumns: [supplierQuoteRequests.organizationId, supplierQuoteRequests.id],
    }),
    foreignKey({
      name: 'supplier_quote_request_items_work_order_item_fk',
      columns: [t.organizationId, t.workOrderItemId],
      foreignColumns: [workOrderItems.organizationId, workOrderItems.id],
    }),
    foreignKey({
      name: 'supplier_quote_request_items_part_fk',
      columns: [t.organizationId, t.partId],
      foreignColumns: [parts.organizationId, parts.id],
    }),
    index('supplier_quote_request_items_request_idx').on(t.organizationId, t.requestId, t.position),
    check('supplier_quote_request_items_quantity_check', sql`${t.quantity} > 0`),
  ],
);

/**
 * O link de cada fornecedor. Um por (cotação, fornecedor): é essa separação que
 * impede um fornecedor de ver o preço do outro.
 *
 * Só o HASH do token (padrão do convite da E2): o link permite cotar em nome do
 * fornecedor, e quem lê o banco não pode forjar preço. Reenviar troca o hash —
 * o link antigo para de funcionar na hora.
 */
export const supplierQuoteInvites = pgTable(
  'supplier_quote_invites',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    requestId: uuid().notNull(),
    supplierId: uuid().notNull(),
    tokenHash: text().notNull(),
    linkIssuedAt: timestamptz().notNull().defaultNow(),
    firstViewedAt: timestamptz(),
    lastViewedAt: timestamptz(),
    viewCount: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('supplier_quote_invites_org_id_unique').on(t.organizationId, t.id),
    unique('supplier_quote_invites_token_hash_unique').on(t.tokenHash),
    unique('supplier_quote_invites_request_supplier_unique').on(t.requestId, t.supplierId),
    foreignKey({
      name: 'supplier_quote_invites_request_fk',
      columns: [t.organizationId, t.requestId],
      foreignColumns: [supplierQuoteRequests.organizationId, supplierQuoteRequests.id],
    }),
    foreignKey({
      name: 'supplier_quote_invites_supplier_fk',
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    check('supplier_quote_invites_token_hash_check', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * Cada envio do fornecedor é uma VERSÃO, e nenhuma se apaga nem se edita
 * (append-only no banco): ele pode corrigir, e a oficina vê o que mudou
 * (decisão de 14/09/2026). É a prova de "você me passou R$ X no dia Y".
 */
export const supplierQuoteResponses = pgTable(
  'supplier_quote_responses',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    inviteId: uuid().notNull(),
    version: integer().notNull(),
    responderName: text().notNull(),
    shippingCents: money(),
    notes: text(),
    /** o hash da cotação que ele viu quando respondeu */
    contentHash: text().notNull(),
    ip: text(),
    userAgent: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('supplier_quote_responses_org_id_unique').on(t.organizationId, t.id),
    // é o índice, e não um `if`, que impede duas versões com o mesmo número
    unique('supplier_quote_responses_invite_version_unique').on(t.inviteId, t.version),
    foreignKey({
      name: 'supplier_quote_responses_invite_fk',
      columns: [t.organizationId, t.inviteId],
      foreignColumns: [supplierQuoteInvites.organizationId, supplierQuoteInvites.id],
    }),
    check('supplier_quote_responses_version_check', sql`${t.version} >= 1`),
    check('supplier_quote_responses_shipping_check', sql`${t.shippingCents} is null or ${t.shippingCents} >= 0`),
  ],
);

export const supplierQuoteResponseItems = pgTable(
  'supplier_quote_response_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    responseId: uuid().notNull(),
    requestItemId: uuid().notNull(),
    availability: text({ enum: OFFER_AVAILABILITIES }).notNull(),
    unitPriceCents: money(),
    brand: text(),
    leadTimeDays: smallint(),
    notes: text(),
  },
  (t) => [
    unique('supplier_quote_response_items_org_id_unique').on(t.organizationId, t.id),
    unique('supplier_quote_response_items_response_item_unique').on(t.responseId, t.requestItemId),
    foreignKey({
      name: 'supplier_quote_response_items_response_fk',
      columns: [t.organizationId, t.responseId],
      foreignColumns: [supplierQuoteResponses.organizationId, supplierQuoteResponses.id],
    }),
    foreignKey({
      name: 'supplier_quote_response_items_request_item_fk',
      columns: [t.organizationId, t.requestItemId],
      foreignColumns: [supplierQuoteRequestItems.organizationId, supplierQuoteRequestItems.id],
    }),
    check(
      'supplier_quote_response_items_availability_check',
      sql`${t.availability} in (${list(OFFER_AVAILABILITIES)})`,
    ),
    // a mesma regra do schema, no banco: "não tenho" sem preço, "tenho" com preço > 0.
    // O `is not null` NÃO é redundante: `null > 0` dá NULL, e CHECK só recusa
    // FALSE — sem ele, "tenho a peça" sem preço passava (o teste de banco pegou).
    check(
      'supplier_quote_response_items_price_check',
      sql`(${t.availability} = 'UNAVAILABLE' and ${t.unitPriceCents} is null)
          or (${t.availability} <> 'UNAVAILABLE' and ${t.unitPriceCents} is not null and ${t.unitPriceCents} > 0)`,
    ),
    check(
      'supplier_quote_response_items_lead_time_check',
      sql`${t.leadTimeDays} is null or ${t.leadTimeDays} between 0 and 365`,
    ),
  ],
);

/**
 * A oferta que venceu, por peça. UMA por item (é o UNIQUE que garante); trocar a
 * escolha é UPDATE, auditado — a compra (E12) é que torna definitivo.
 */
export const supplierQuoteAwards = pgTable(
  'supplier_quote_awards',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    requestItemId: uuid().notNull(),
    responseItemId: uuid().notNull(),
    awardedBy: uuid()
      .notNull()
      .references(() => users.id),
    awardedAt: timestamptz().notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique('supplier_quote_awards_org_id_unique').on(t.organizationId, t.id),
    // UMA escolha por peça: é o índice, e não um `if`, que garante
    unique('supplier_quote_awards_request_item_unique').on(t.requestItemId),
    foreignKey({
      name: 'supplier_quote_awards_request_item_fk',
      columns: [t.organizationId, t.requestItemId],
      foreignColumns: [supplierQuoteRequestItems.organizationId, supplierQuoteRequestItems.id],
    }),
    foreignKey({
      name: 'supplier_quote_awards_response_item_fk',
      columns: [t.organizationId, t.responseItemId],
      foreignColumns: [supplierQuoteResponseItems.organizationId, supplierQuoteResponseItems.id],
    }),
  ],
);

/**
 * Quanto cada fornecedor cobrou por cada peça, ao longo do tempo. Append-only:
 * preço passado não se corrige, se registra outro. A E11 grava as ofertas quando
 * a cotação encerra; a E12 vai gravar o preço das compras.
 */
export const partPriceHistory = pgTable(
  'part_price_history',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    partId: uuid().notNull(),
    supplierId: uuid(),
    priceCents: money().notNull(),
    source: text({ enum: PRICE_SOURCES }).notNull(),
    supplierQuoteRequestId: uuid(),
    capturedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'part_price_history_part_fk',
      columns: [t.organizationId, t.partId],
      foreignColumns: [parts.organizationId, parts.id],
    }),
    foreignKey({
      name: 'part_price_history_supplier_fk',
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    foreignKey({
      name: 'part_price_history_request_fk',
      columns: [t.organizationId, t.supplierQuoteRequestId],
      foreignColumns: [supplierQuoteRequests.organizationId, supplierQuoteRequests.id],
    }),
    index('part_price_history_part_idx').on(t.organizationId, t.partId, t.capturedAt.desc()),
    check('part_price_history_source_check', sql`${t.source} in (${list(PRICE_SOURCES)})`),
    check('part_price_history_price_check', sql`${t.priceCents} > 0`),
  ],
);
