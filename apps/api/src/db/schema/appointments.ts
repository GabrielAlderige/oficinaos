import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { APPOINTMENT_STATUSES } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { customers, vehicles } from './customers';
import { services } from './catalog';
import { memberships, organizations, users } from './tenancy';
import { workOrders } from './work-orders';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * Agenda (docs/DATABASE.md §5.4). O agendamento é o compromisso; a OS só nasce
 * no **check-in**, quando o carro chega — por isso `work_order_id` é anulável e
 * os dois ficam ligados nos dois sentidos.
 *
 * Conflito de horário é conferido na aplicação (`shared/calendar.ts`) e devolvido
 * como aviso. Uma *exclusion constraint* com `btree_gist` bloquearia sem
 * escapatória, e oficina de verdade encaixa cliente. Ela fica guardada para o dia
 * em que houver agenda por box/elevador, que é recurso físico de verdade.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    customerId: uuid().notNull(),
    /** anulável: o veículo pode ser cadastrado só no check-in */
    vehicleId: uuid(),
    /** sem mecânico definido o compromisso não disputa a hora de ninguém */
    mechanicUserId: uuid(),
    serviceId: uuid(),
    /** o que vai ser feito: "Troca de embreagem" */
    title: text().notNull(),
    startsAt: timestamptz().notNull(),
    endsAt: timestamptz().notNull(),
    status: text({ enum: APPOINTMENT_STATUSES }).notNull().default('SCHEDULED'),
    notes: text(),
    /** preenchido no check-in, junto com `work_orders.appointment_id` */
    workOrderId: uuid(),
    confirmedAt: timestamptz(),
    canceledAt: timestamptz(),
    cancelReason: text(),
    createdBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('appointments_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'appointments_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    foreignKey({
      name: 'appointments_vehicle_fk',
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }),
    foreignKey({
      name: 'appointments_service_fk',
      columns: [t.organizationId, t.serviceId],
      foreignColumns: [services.organizationId, services.id],
    }),
    // o mecânico tem de ser da equipe DESTA oficina: a FK é com a associação
    foreignKey({
      name: 'appointments_mechanic_fk',
      columns: [t.organizationId, t.mechanicUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      name: 'appointments_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    index('appointments_starts_idx').on(t.organizationId, t.startsAt),
    index('appointments_mechanic_starts_idx').on(t.organizationId, t.mechanicUserId, t.startsAt),
    index('appointments_customer_idx').on(t.organizationId, t.customerId, t.startsAt.desc()),
    check('appointments_status_check', sql`${t.status} in (${list(APPOINTMENT_STATUSES)})`),
    check('appointments_period_check', sql`${t.endsAt} > ${t.startsAt}`),
    // sumir da agenda sem explicação vira discussão com o cliente depois
    check(
      'appointments_cancel_reason_check',
      sql`${t.canceledAt} is null or ${t.cancelReason} is not null`,
    ),
    check(
      'appointments_canceled_consistency_check',
      sql`${t.status} <> 'CANCELED' or ${t.canceledAt} is not null`,
    ),
  ],
);
