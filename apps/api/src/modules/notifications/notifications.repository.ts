import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { notifications } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type NotificationRow = typeof notifications.$inferSelect;

/**
 * O RLS isola a oficina; o filtro por pessoa é aqui, porque dentro da mesma
 * oficina cada um tem a sua caixa (docs/DATABASE.md §5.8).
 */
const mine = (organizationId: string, userId: string) =>
  and(eq(notifications.organizationId, organizationId), eq(notifications.userId, userId));

export async function listForUser(tx: Tx, organizationId: string, userId: string, limit: number): Promise<NotificationRow[]> {
  return tx
    .select()
    .from(notifications)
    .where(mine(organizationId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnread(tx: Tx, organizationId: string, userId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(notifications)
    .where(and(mine(organizationId, userId), isNull(notifications.readAt)));
  return row?.value ?? 0;
}

export async function markAllRead(tx: Tx, organizationId: string, userId: string): Promise<void> {
  await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(mine(organizationId, userId), isNull(notifications.readAt)));
}

/** Marcar de novo não muda a hora: quando foi lido é quando foi lido. */
export async function markRead(tx: Tx, organizationId: string, userId: string, id: string): Promise<void> {
  await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(mine(organizationId, userId), eq(notifications.id, id), isNull(notifications.readAt)));
}
