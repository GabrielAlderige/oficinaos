import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamptz } from './_columns';
import { organizations, users } from './tenancy';

/**
 * Trilha de auditoria. Append-only: a migration de RLS tira UPDATE e DELETE
 * da role da aplicação nesta tabela.
 */
export const activityLogs = pgTable(
  'activity_logs',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    actorType: text({ enum: ['USER', 'CUSTOMER', 'SYSTEM'] }).notNull(),
    actorUserId: uuid().references(() => users.id),
    /** ex.: 'work_order.created', 'work_order_item.price_changed' */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    /** atalho para "tudo o que aconteceu nesta OS"; a FK entra junto com work_orders (E5) */
    workOrderId: uuid(),
    /** {"unit_price_cents": {"from": 18990, "to": 15000}} */
    changes: jsonb().$type<Record<string, { from: unknown; to: unknown }>>(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    ip: inet(),
    userAgent: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('activity_logs_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('activity_logs_org_entity_idx').on(
      t.organizationId,
      t.entityType,
      t.entityId,
      t.createdAt.desc(),
    ),
    check('activity_logs_actor_type_check', sql`${t.actorType} in ('USER', 'CUSTOMER', 'SYSTEM')`),
  ],
);
