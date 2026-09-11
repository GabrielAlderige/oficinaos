import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { PLAN_CODES, SUBSCRIPTION_STATUSES, type PlanLimits } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { organizations } from './tenancy';

const statusList = sql.raw(SUBSCRIPTION_STATUSES.map((s) => `'${s}'`).join(','));

/** Planos do SaaS. Global; os valores vêm por migration (dado de referência). */
export const plans = pgTable('plans', {
  id: id(),
  code: text({ enum: PLAN_CODES }).notNull().unique(),
  name: text().notNull(),
  priceMonthlyCents: bigint({ mode: 'number' }).notNull(),
  priceYearlyCents: bigint({ mode: 'number' }),
  limits: jsonb().$type<PlanLimits>().notNull(),
  features: text().array().notNull().default(sql`'{}'::text[]`),
  isPublic: boolean().notNull().default(true),
  createdAt: timestamptz().notNull().defaultNow(),
});

/** Assinatura da oficina. No MVP 1 não há cobrança: todo cadastro nasce em teste. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .unique()
      .references(() => organizations.id),
    planId: uuid()
      .notNull()
      .references(() => plans.id),
    status: text({ enum: SUBSCRIPTION_STATUSES }).notNull(),
    trialEndsAt: timestamptz(),
    currentPeriodStart: timestamptz(),
    currentPeriodEnd: timestamptz(),
    cancelAtPeriodEnd: boolean().notNull().default(false),
    provider: text(),
    providerCustomerId: text(),
    providerSubscriptionId: text(),
    ...timestamps,
  },
  (t) => [check('subscriptions_status_check', sql`${t.status} in (${statusList})`)],
);

/** Contadores de uso por período (ex.: OS no mês), para limite de plano sem COUNT(*). */
export const usageCounters = pgTable(
  'usage_counters',
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    metric: text().notNull(),
    /** '2026-09' */
    period: text().notNull(),
    value: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.metric, t.period] })],
);
