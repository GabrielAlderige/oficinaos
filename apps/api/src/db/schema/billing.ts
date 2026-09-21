import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { BILLING_CYCLES, PLAN_CODES, SUBSCRIPTION_STATUSES, type PlanLimits } from '@oficinaos/shared';
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
    /** mensal ou anual (E20); o anual só existe se o plano tiver preço anual */
    billingCycle: text({ enum: BILLING_CYCLES }).notNull().default('MONTHLY'),
    /** o preço congelado no momento da assinatura: mudar a tabela não remarca */
    priceCents: bigint({ mode: 'number' }),
    trialEndsAt: timestamptz(),
    currentPeriodStart: timestamptz(),
    currentPeriodEnd: timestamptz(),
    /**
     * Quando o pagamento venceu sem entrar. A carência (E20) conta a partir
     * daqui, e "bloqueada" é calculado — não gravado, para não depender de um
     * job noturno para a tela ficar certa (mesma escolha da D31).
     */
    pastDueSince: timestamptz(),
    canceledAt: timestamptz(),
    cancelReason: text(),
    cancelAtPeriodEnd: boolean().notNull().default(false),
    provider: text(),
    providerCustomerId: text(),
    providerSubscriptionId: text(),
    /** a página de pagamento da assinatura no gateway */
    checkoutUrl: text(),
    ...timestamps,
  },
  (t) => [
    check('subscriptions_status_check', sql`${t.status} in (${statusList})`),
    check('subscriptions_cycle_check', sql`${t.billingCycle} in ('MONTHLY', 'YEARLY')`),
  ],
);

/**
 * O que a oficina já pagou de assinatura (E20). Existe para ela ver o próprio
 * histórico sem entrar no painel do gateway — e para o suporte conferir uma
 * cobrança contestada sem depender de captura de tela.
 */
export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    provider: text().notNull(),
    providerPaymentId: text(),
    amountCents: bigint({ mode: 'number' }).notNull(),
    status: text().notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    paidAt: timestamptz(),
    periodStart: date({ mode: 'string' }),
    periodEnd: date({ mode: 'string' }),
    invoiceUrl: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('subscription_payments_provider_unique').on(t.provider, t.providerPaymentId),
    index('subscription_payments_org_idx').on(t.organizationId, t.dueDate),
  ],
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
