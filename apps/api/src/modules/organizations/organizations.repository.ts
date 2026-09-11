import { eq } from 'drizzle-orm';
import { organizations } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type OrganizationRow = typeof organizations.$inferSelect;

export async function findOrganization(tx: Tx, id: string) {
  const [row] = await tx.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  return row;
}

export async function lockOrganization(tx: Tx, id: string) {
  const [row] = await tx.select().from(organizations).where(eq(organizations.id, id)).limit(1).for('update');
  return row;
}

export async function updateOrganization(tx: Tx, id: string, patch: Partial<typeof organizations.$inferInsert>) {
  const [row] = await tx.update(organizations).set(patch).where(eq(organizations.id, id)).returning();
  return row!;
}
