import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, timestamptz } from './_columns';
import { organizations, users } from './tenancy';
import { workOrderItems, workOrders } from './work-orders';

/**
 * Cronômetro por item de serviço (docs/ROADMAP.md, MVP 2, E15). O mecânico
 * aperta "iniciar" quando põe a mão no carro e "parar" quando termina; o
 * relatório compara o tempo REAL com o estimado do catálogo.
 *
 * Cada volta é uma linha (almoço, peça que faltou, dia seguinte): o total do
 * item é a soma, e não a diferença entre o primeiro início e o último fim.
 *
 * Só UM cronômetro aberto por mecânico em toda a oficina — ninguém trabalha em
 * dois carros ao mesmo tempo, e sem essa trava o tempo real viraria ficção.
 */
export const workOrderItemTimers = pgTable(
  'work_order_item_timers',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    workOrderId: uuid().notNull(),
    workOrderItemId: uuid().notNull(),
    mechanicUserId: uuid()
      .notNull()
      .references(() => users.id),
    startedAt: timestamptz().notNull().defaultNow(),
    stoppedAt: timestamptz(),
    /** minutos fechados desta volta; null enquanto está correndo */
    minutes: integer(),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    unique('work_order_item_timers_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'work_order_item_timers_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'work_order_item_timers_item_fk',
      columns: [t.organizationId, t.workOrderItemId],
      foreignColumns: [workOrderItems.organizationId, workOrderItems.id],
    }),
    // a trava do "um de cada vez": índice único parcial só entre os abertos
    uniqueIndex('work_order_item_timers_running_unique')
      .on(t.organizationId, t.mechanicUserId)
      .where(sql`stopped_at is null`),
    index('work_order_item_timers_item_idx').on(t.organizationId, t.workOrderItemId, t.startedAt),
    index('work_order_item_timers_mechanic_idx').on(t.organizationId, t.mechanicUserId, t.startedAt.desc()),
    check('work_order_item_timers_minutes_check', sql`${t.minutes} is null or ${t.minutes} >= 0`),
    check(
      'work_order_item_timers_stopped_check',
      sql`(${t.stoppedAt} is null) = (${t.minutes} is null) and (${t.stoppedAt} is null or ${t.stoppedAt} >= ${t.startedAt})`,
    ),
  ],
);
