import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { PlanCode } from '@oficinaos/shared';
import { memberships, plans, subscriptionPayments, subscriptions, workOrders } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;

export async function findSubscription(tx: Tx, organizationId: string): Promise<SubscriptionRow | undefined> {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  return row;
}

/** Trava a assinatura: dois avisos do gateway ao mesmo tempo não brigam. */
export async function lockSubscription(tx: Tx, organizationId: string): Promise<SubscriptionRow | undefined> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1)
    .for('update');
  return row;
}

/** Pela referência do gateway, com a capacidade do webhook (`withSubscriptionRef`). */
export async function findByProviderRef(tx: Tx, providerSubscriptionId: string): Promise<SubscriptionRow | undefined> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId))
    .limit(1);
  return row;
}

export async function updateSubscription(
  tx: Tx,
  organizationId: string,
  patch: Partial<typeof subscriptions.$inferInsert>,
): Promise<SubscriptionRow> {
  const [row] = await tx
    .update(subscriptions)
    .set(patch)
    .where(eq(subscriptions.organizationId, organizationId))
    .returning();
  return row!;
}

export async function listPlans(tx: Tx): Promise<PlanRow[]> {
  return tx.select().from(plans).where(eq(plans.isPublic, true)).orderBy(plans.priceMonthlyCents);
}

export async function findPlanByCode(tx: Tx, code: PlanCode): Promise<PlanRow | undefined> {
  const [row] = await tx.select().from(plans).where(eq(plans.code, code)).limit(1);
  return row;
}

export async function findPlanById(tx: Tx, id: string): Promise<PlanRow | undefined> {
  const [row] = await tx.select().from(plans).where(eq(plans.id, id)).limit(1);
  return row;
}

/** Uso do plano: gente na equipe e OS abertas no mês. */
export async function usage(tx: Tx, organizationId: string, inicioDoMes: Date) {
  const [pessoas] = await tx
    .select({ total: count() })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.isActive, true)));
  const [ordens] = await tx
    .select({ total: count() })
    .from(workOrders)
    .where(and(eq(workOrders.organizationId, organizationId), gte(workOrders.createdAt, inicioDoMes)));
  return { users: Number(pessoas?.total ?? 0), workOrdersThisMonth: Number(ordens?.total ?? 0) };
}

export function listPayments(tx: Tx, organizationId: string, limite = 24) {
  return tx
    .select()
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.organizationId, organizationId))
    .orderBy(desc(subscriptionPayments.dueDate))
    .limit(limite);
}

/**
 * Registra a cobrança da assinatura. Devolve `undefined` quando o gateway
 * reenviou o mesmo aviso — o UNIQUE (provider, providerPaymentId) é a trava
 * que impede contar o mesmo pagamento duas vezes.
 */
export async function insertPayment(
  tx: Tx,
  values: typeof subscriptionPayments.$inferInsert,
): Promise<typeof subscriptionPayments.$inferSelect | undefined> {
  const [row] = await tx.insert(subscriptionPayments).values(values).onConflictDoNothing().returning();
  return row;
}

/** Oficinas com o teste vencido e sem assinatura: viram EXPIRED (E20). */
export async function expirarTestesVencidos(tx: Tx, limite: Date): Promise<number> {
  const { rowCount } = await tx.execute(sql`
    update subscriptions
    set status = 'EXPIRED', updated_at = now()
    where status = 'TRIALING' and trial_ends_at is not null and trial_ends_at < ${limite}
      and provider_subscription_id is null
  `);
  return rowCount ?? 0;
}

export const semAssinatura = isNull;
