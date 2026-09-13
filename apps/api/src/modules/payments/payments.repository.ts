import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { payments, users } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type PaymentRow = typeof payments.$inferSelect;

const recorder = alias(users, 'recorded_by_user');
const canceller = alias(users, 'canceled_by_user');

const daOS = (organizationId: string, workOrderId: string) =>
  and(eq(payments.organizationId, organizationId), eq(payments.workOrderId, workOrderId));

export async function insertPayment(tx: Tx, values: typeof payments.$inferInsert) {
  const [row] = await tx.insert(payments).values(values).returning();
  return row!;
}

export function listPayments(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select({ payment: payments, recordedByName: recorder.name, canceledByName: canceller.name })
    .from(payments)
    .leftJoin(recorder, eq(recorder.id, payments.createdBy))
    .leftJoin(canceller, eq(canceller.id, payments.canceledBy))
    .where(daOS(organizationId, workOrderId))
    .orderBy(desc(payments.createdAt));
}

/** Trava o lançamento: dois cancelamentos simultâneos não se atropelam. */
export async function lockPayment(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.organizationId, organizationId), eq(payments.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function updatePayment(tx: Tx, id: string, patch: Partial<typeof payments.$inferInsert>) {
  const [row] = await tx.update(payments).set(patch).where(eq(payments.id, id)).returning();
  return row!;
}

/**
 * Quanto a oficina realmente recebeu nesta OS. É a ÚNICA fonte de `paid_cents`:
 * a soma vem dos lançamentos confirmados, nunca de valor mandado pela tela.
 */
export async function sumConfirmedCents(tx: Tx, organizationId: string, workOrderId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${payments.amountCents}), 0)` })
    .from(payments)
    .where(and(daOS(organizationId, workOrderId), eq(payments.status, 'CONFIRMED')));
  return Number(row?.total ?? 0);
}
