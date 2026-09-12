import { and, desc, eq, isNull } from 'drizzle-orm';
import { attachments } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type AttachmentRow = typeof attachments.$inferSelect;

const alive = (organizationId: string) =>
  and(eq(attachments.organizationId, organizationId), isNull(attachments.deletedAt));

export async function insertAttachment(tx: Tx, values: typeof attachments.$inferInsert) {
  const [row] = await tx.insert(attachments).values(values).returning();
  return row!;
}

export async function findAttachment(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(attachments)
    .where(and(alive(organizationId), eq(attachments.id, id)))
    .limit(1);
  return row;
}

export async function markReady(tx: Tx, id: string, sizeBytes: number) {
  const [row] = await tx
    .update(attachments)
    .set({ status: 'READY', sizeBytes })
    .where(eq(attachments.id, id))
    .returning();
  return row!;
}

export async function softDeleteAttachment(tx: Tx, id: string) {
  await tx.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, id));
}

export function listByWorkOrder(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select()
    .from(attachments)
    .where(and(alive(organizationId), eq(attachments.workOrderId, workOrderId)))
    .orderBy(desc(attachments.createdAt));
}
