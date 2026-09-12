import { and, asc, count, eq, isNull, or, sql } from 'drizzle-orm';
import { likeContains } from '../../core/normalize';
import { services } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type ServiceRow = typeof services.$inferSelect;

const active = (organizationId: string) => and(eq(services.organizationId, organizationId), isNull(services.deletedAt));

export async function listServices(
  tx: Tx,
  organizationId: string,
  options: { q?: string; status: 'active' | 'inactive' | 'all'; limit: number; offset: number },
) {
  const where = and(
    active(organizationId),
    options.status === 'all' ? undefined : eq(services.isActive, options.status === 'active'),
    options.q
      ? or(
          sql`immutable_unaccent(services.name) ilike immutable_unaccent(${likeContains(options.q)})`,
          sql`immutable_unaccent(coalesce(services.category, '')) ilike immutable_unaccent(${likeContains(options.q)})`,
        )
      : undefined,
  );
  const rows = await tx
    .select()
    .from(services)
    .where(where)
    .orderBy(asc(services.name))
    .limit(options.limit)
    .offset(options.offset);
  const [counted] = await tx.select({ total: count() }).from(services).where(where);
  return { rows, total: counted?.total ?? 0 };
}

export async function findService(tx: Tx, organizationId: string, id: string, lock = false) {
  const query = tx.select().from(services).where(and(active(organizationId), eq(services.id, id))).limit(1);
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

export async function insertService(tx: Tx, values: typeof services.$inferInsert) {
  const [row] = await tx.insert(services).values(values).returning();
  return row!;
}

export async function updateService(tx: Tx, id: string, patch: Partial<typeof services.$inferInsert>) {
  const [row] = await tx.update(services).set(patch).where(eq(services.id, id)).returning();
  return row!;
}

export async function softDeleteService(tx: Tx, id: string) {
  await tx.update(services).set({ deletedAt: new Date() }).where(eq(services.id, id));
}
