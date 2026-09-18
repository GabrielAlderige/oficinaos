import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { PAYMENT_ENTRY_STATUSES, PAYMENT_METHODS } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { customers } from './customers';
import { organizations, users } from './tenancy';
import { workOrders } from './work-orders';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });

/**
 * Pagamento recebido (docs/DATABASE.md §5.8). No MVP 1 é **registro manual**: a
 * oficina anota o que já entrou. Cobrança por gateway é V3 — as colunas
 * `provider*` ficam reservadas para lá.
 *
 * Pagamento **nunca é apagado**: erro vira `CANCELED` com motivo, e o histórico
 * continua. Por isso a tabela não é append-only como as provas do orçamento:
 * cancelar é um UPDATE legítimo.
 *
 * `paid_cents` e `payment_status` da OS são sempre recalculados a partir daqui
 * (soma dos confirmados), nunca gravados pela tela.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    /** anulável de propósito: pagamento avulso, sem OS, é MVP 2 */
    workOrderId: uuid(),
    customerId: uuid().notNull(),
    /** MVP 2: baixa de um lançamento do financeiro */
    financialEntryId: uuid(),
    /**
     * Gerado pela tela (E13): clique duplo, ou rede que repete o POST, não
     * registra o pagamento duas vezes. Nulo nos lançamentos anteriores à E13.
     */
    clientRequestId: uuid(),
    method: text({ enum: PAYMENT_METHODS }).notNull(),
    amountCents: money().notNull(),
    /** só registro: parcelar no cartão não gera cobrança no MVP 1 */
    installments: smallint().notNull().default(1),
    status: text({ enum: PAYMENT_ENTRY_STATUSES }).notNull().default('CONFIRMED'),
    /** quando o dinheiro entrou, que pode não ser quando foi anotado */
    paidAt: timestamptz().notNull(),
    /** V3: gateway */
    provider: text(),
    providerPaymentId: text(),
    notes: text(),
    canceledAt: timestamptz(),
    canceledBy: uuid().references(() => users.id),
    cancelReason: text(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'payments_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'payments_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    index('payments_work_order_idx').on(t.organizationId, t.workOrderId, t.createdAt.desc()),
    index('payments_customer_idx').on(t.organizationId, t.customerId, t.createdAt.desc()),
    uniqueIndex('payments_client_request_unique')
      .on(t.organizationId, t.clientRequestId)
      .where(sql`client_request_id is not null`),
    check('payments_method_check', sql`${t.method} in (${list(PAYMENT_METHODS)})`),
    check('payments_status_check', sql`${t.status} in (${list(PAYMENT_ENTRY_STATUSES)})`),
    check('payments_amount_check', sql`${t.amountCents} > 0`),
    check('payments_installments_check', sql`${t.installments} >= 1`),
    // cancelado sem motivo não conta história: a auditoria precisa saber por quê
    check('payments_cancel_reason_check', sql`${t.canceledAt} is null or ${t.cancelReason} is not null`),
    check(
      'payments_canceled_consistency_check',
      sql`${t.status} <> 'CANCELED' or ${t.canceledAt} is not null`,
    ),
  ],
);
