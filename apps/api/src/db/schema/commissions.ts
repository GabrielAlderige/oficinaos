import { bigint, date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, timestamptz } from './_columns';

const money = () => bigint({ mode: 'number' });
import { organizations, users } from './tenancy';

/**
 * O fechamento da comissão (E26): "paguei R$ 1.240 ao Zé, referente a
 * setembro".
 *
 * A comissão em si **não** é gravada linha a linha: ela é calculada do que o
 * cliente pagou, com o percentual congelado no item da OS. Guardar o cálculo
 * junto seria duas verdades para a mesma conta, e elas divergem no dia em que
 * um pagamento é cancelado.
 *
 * O que precisa ser fato registrado é o **pagamento ao mecânico** — esse não
 * se recalcula: ou o dinheiro saiu, ou não saiu.
 */
export const commissionPayouts = pgTable(
  'commission_payouts',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    mechanicUserId: uuid()
      .notNull()
      .references(() => users.id),
    /** o período a que o pagamento se refere, em dias do calendário da oficina */
    periodFrom: date().notNull(),
    periodTo: date().notNull(),
    amountCents: money().notNull(),
    notes: text(),
    paidAt: timestamptz().notNull().defaultNow(),
    createdBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [index('commission_payouts_mechanic_idx').on(t.organizationId, t.mechanicUserId, t.paidAt.desc())],
);
