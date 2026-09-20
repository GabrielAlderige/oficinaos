import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { CHARGE_METHODS, CHARGE_STATUSES, PAYMENT_ENVIRONMENTS } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { customers } from './customers';
import { payments } from './payments';
import { organizations, users } from './tenancy';
import { workOrders } from './work-orders';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });

/**
 * Cobrança online (V3, E19): o pedido de pagamento que a oficina manda.
 *
 * **Cobrança não é pagamento.** Quando o gateway avisa que caiu, nasce uma
 * linha em `payments` — o mesmo caixa do dinheiro recebido na mão — e é ela
 * que mexe no saldo da OS. Assim "recebido" continua sendo um número só,
 * venha de onde vier (D30).
 */
export const charges = pgTable(
  'charges',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    workOrderId: uuid().notNull(),
    customerId: uuid().notNull(),
    method: text({ enum: CHARGE_METHODS }).notNull(),
    status: text({ enum: CHARGE_STATUSES }).notNull().default('PENDING'),
    environment: text({ enum: PAYMENT_ENVIRONMENTS }).notNull(),
    provider: text().notNull(),
    /** o mesmo POST repetido devolve a mesma cobrança, não cobra duas vezes */
    clientRequestId: uuid().notNull(),
    amountCents: money().notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    description: text().notNull(),
    /**
     * O id da cobrança no gateway. É por ele que o aviso (webhook) encontra a
     * linha, então tem índice único GLOBAL: id de gateway não se repete entre
     * oficinas, e é isso que deixa a conciliação achar a dona do dinheiro.
     */
    providerChargeId: text(),
    providerCustomerId: text(),
    paymentUrl: text(),
    pixPayload: text(),
    pixQrImage: text(),
    boletoUrl: text(),
    barcode: text(),
    /** o pagamento criado no caixa quando a cobrança foi paga */
    paymentId: uuid(),
    paidAt: timestamptz(),
    paidAmountCents: money(),
    canceledAt: timestamptz(),
    cancelReason: text(),
    canceledBy: uuid().references(() => users.id),
    refundedAt: timestamptz(),
    failureReason: text(),
    /** a última resposta do gateway, inteira: é ela que explica uma recusa */
    providerResponse: jsonb().$type<Record<string, unknown>>(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('charges_org_id_unique').on(t.organizationId, t.id),
    uniqueIndex('charges_client_request_unique').on(t.organizationId, t.clientRequestId),
    uniqueIndex('charges_provider_charge_unique').on(t.provider, t.providerChargeId),
    foreignKey({
      name: 'charges_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'charges_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    foreignKey({
      name: 'charges_payment_fk',
      columns: [t.organizationId, t.paymentId],
      foreignColumns: [payments.organizationId, payments.id],
    }),
    index('charges_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('charges_work_order_idx').on(t.organizationId, t.workOrderId),
    check('charges_method_check', sql`${t.method} in (${list(CHARGE_METHODS)})`),
    check('charges_status_check', sql`${t.status} in (${list(CHARGE_STATUSES)})`),
    check('charges_environment_check', sql`${t.environment} in (${list(PAYMENT_ENVIRONMENTS)})`),
    check('charges_amount_check', sql`${t.amountCents} > 0`),
    // cancelada sem motivo não conta história (mesma regra do pagamento, E7)
    check(
      'charges_canceled_check',
      sql`(${t.status} = 'CANCELED') = (${t.canceledAt} is not null) and (${t.canceledAt} is null or ${t.cancelReason} is not null)`,
    ),
    // paga é o único estado em que o dinheiro entrou
    check('charges_paid_check', sql`${t.status} <> 'PAID' or (${t.paidAt} is not null and ${t.paymentId} is not null)`),
  ],
);

/**
 * Aviso do gateway já processado (E19). O gateway REENVIA o mesmo aviso quando
 * não recebe 200 — sem esta tabela, um reenvio daria baixa duas vezes no mesmo
 * dinheiro. A chave é o id do evento no gateway.
 */
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: id(),
    provider: text().notNull(),
    externalId: text().notNull(),
    eventType: text().notNull(),
    /**
     * A oficina dona da cobrança. Só guardamos aviso que conseguimos atribuir:
     * aviso de cobrança que não é nossa é registrado no log e descartado, não
     * vira linha órfã no banco de ninguém.
     */
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    chargeId: uuid().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    processedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_webhook_events_unique').on(t.provider, t.externalId)],
);
