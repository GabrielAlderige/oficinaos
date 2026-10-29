import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { POS_CHARGE_STATUSES, POS_METHODS, type PosDevice } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { counterSales } from './counter-sales';
import { organizations, users } from './tenancy';
import { workOrders } from './work-orders';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });

/**
 * A maquininha da oficina (E50). A chave da conta Stone fica CIFRADA com a
 * SECRETS_KEY do servidor — a mesma regra do token do emissor fiscal: o banco
 * sozinho (ou um backup dele) não move dinheiro de ninguém.
 */
export const posSettings = pgTable('pos_settings', {
  organizationId: uuid()
    .primaryKey()
    .references(() => organizations.id),
  provider: text().notNull().default('simulador'),
  secretKeyEnc: text(),
  /** os 4 últimos caracteres da chave, para a tela mostrar qual está ligada */
  keyHint: text(),
  devices: jsonb().$type<PosDevice[]>().notNull().default([]),
  updatedBy: uuid().references(() => users.id),
  ...timestamps,
});

/**
 * Uma cobrança mandada para a maquininha (E50). Como a cobrança online (E19),
 * **cobrança não é pagamento**: quando a maquininha confirma, nasce o
 * pagamento da OS (ou a baixa da venda de balcão), e é ele que mexe no caixa.
 */
export const posCharges = pgTable(
  'pos_charges',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    workOrderId: uuid(),
    counterSaleId: uuid(),
    method: text({ enum: POS_METHODS }).notNull(),
    installments: integer().notNull().default(1),
    amountCents: money().notNull(),
    deviceSerial: text().notNull(),
    status: text({ enum: POS_CHARGE_STATUSES }).notNull().default('PENDING'),
    environment: text({ enum: ['SIMULATOR', 'PRODUCTION'] }).notNull(),
    provider: text().notNull(),
    /** o mesmo POST repetido devolve a mesma cobrança, não manda duas para a maquininha */
    clientRequestId: uuid().notNull(),
    /** o pedido na Pagar.me (or_...): é por ele que o aviso acha a oficina — único no mundo */
    providerOrderId: text(),
    providerChargeId: text(),
    paidAmountCents: money(),
    paidAt: timestamptz(),
    cardBrand: text(),
    authorizationCode: text(),
    /** o pagamento da OS (payments.id) ou a baixa da venda (financial_settlements.id) criado ao pagar */
    settlementRef: uuid(),
    failureReason: text(),
    canceledAt: timestamptz(),
    providerResponse: jsonb().$type<Record<string, unknown>>(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('pos_charges_org_id_unique').on(t.organizationId, t.id),
    uniqueIndex('pos_charges_client_request_unique').on(t.organizationId, t.clientRequestId),
    uniqueIndex('pos_charges_provider_order_unique').on(t.provider, t.providerOrderId),
    foreignKey({
      name: 'pos_charges_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'pos_charges_counter_sale_fk',
      columns: [t.organizationId, t.counterSaleId],
      foreignColumns: [counterSales.organizationId, counterSales.id],
    }),
    index('pos_charges_work_order_idx').on(t.organizationId, t.workOrderId),
    index('pos_charges_counter_sale_idx').on(t.organizationId, t.counterSaleId),
    check('pos_charges_origin_check', sql`(${t.workOrderId} is null) <> (${t.counterSaleId} is null)`),
    check('pos_charges_method_check', sql`${t.method} in (${list(POS_METHODS)})`),
    check('pos_charges_status_check', sql`${t.status} in (${list(POS_CHARGE_STATUSES)})`),
    check('pos_charges_amount_check', sql`${t.amountCents} > 0`),
    check('pos_charges_installments_check', sql`${t.installments} between 1 and 12`),
    // paga é o único estado em que o dinheiro entrou no caixa
    check('pos_charges_paid_check', sql`${t.status} not in ('PAID', 'REFUNDED') or (${t.paidAt} is not null and ${t.settlementRef} is not null)`),
  ],
);
