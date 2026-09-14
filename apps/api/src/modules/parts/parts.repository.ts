import { and, asc, count, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { likeContains } from '../../core/normalize';
import { inventoryMovements, partApplications, partCategories, parts, suppliers, users } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type PartRow = typeof parts.$inferSelect;

const categoryJoin = and(eq(partCategories.organizationId, parts.organizationId), eq(partCategories.id, parts.categoryId));
const active = (organizationId: string) => and(eq(parts.organizationId, organizationId), isNull(parts.deletedAt));

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'e', 'com', 'o', 'a']);

/**
 * Cada palavra precisa aparecer em algum lugar: nome, código interno, código do
 * fabricante, marca da peça ou aplicação (marca/modelo/motor do carro). Palavra de
 * 4 dígitos também vale como ano dentro da faixa da aplicação.
 * "pastilha gol 2012" → pastilha com aplicação VW Gol 2008–2016.
 * Subconsultas usam nomes de tabela ESCRITOS (ver lição da E3 sobre o Drizzle).
 */
function wordMatches(word: string): SQL {
  const pattern = likeContains(word);
  const conditions: SQL[] = [
    sql`immutable_unaccent(parts.name) ilike immutable_unaccent(${pattern})`,
    sql`parts.sku ilike ${pattern}`,
    sql`parts.manufacturer_code ilike ${pattern}`,
    sql`immutable_unaccent(coalesce(parts.manufacturer, '')) ilike immutable_unaccent(${pattern})`,
    sql`exists (
      select 1 from part_applications a
      where a.organization_id = parts.organization_id and a.part_id = parts.id
        and immutable_unaccent(a.make || ' ' || coalesce(a.model, '') || ' ' || coalesce(a.engine, '')) ilike immutable_unaccent(${pattern})
    )`,
  ];
  const year = Number(word);
  if (/^\d{4}$/.test(word) && year >= 1950 && year <= 2100) {
    conditions.push(sql`exists (
      select 1 from part_applications a
      where a.organization_id = parts.organization_id and a.part_id = parts.id
        and (a.year_from is null or a.year_from <= ${year}) and (a.year_to is null or a.year_to >= ${year})
    )`);
  }
  return or(...conditions)!;
}

export function partMatches(q: string): SQL | undefined {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));
  return words.length ? and(...words.map(wordMatches)) : undefined;
}

/** Abaixo do mínimo, sem estoque ou negativo (disponível < máx(mínimo, 0,001)). */
const needsAttention = sql`parts.track_stock and (
  parts.quantity_on_hand < 0 or parts.quantity_on_hand - parts.quantity_reserved < greatest(parts.min_quantity, 0.001)
)`;

const listColumns = {
  id: parts.id,
  name: parts.name,
  sku: parts.sku,
  manufacturerCode: parts.manufacturerCode,
  manufacturer: parts.manufacturer,
  categoryName: partCategories.name,
  unit: parts.unit,
  salePriceCents: parts.salePriceCents,
  quantityOnHand: parts.quantityOnHand,
  quantityReserved: parts.quantityReserved,
  minQuantity: parts.minQuantity,
  trackStock: parts.trackStock,
  location: parts.location,
};

export async function listParts(
  tx: Tx,
  organizationId: string,
  options: {
    q?: string;
    categoryId?: string;
    supplierId?: string;
    attentionOnly: boolean;
    limit: number;
    offset: number;
  },
) {
  const where = and(
    active(organizationId),
    options.categoryId ? eq(parts.categoryId, options.categoryId) : undefined,
    options.supplierId ? eq(parts.preferredSupplierId, options.supplierId) : undefined,
    options.attentionOnly ? needsAttention : undefined,
    options.q ? partMatches(options.q) : undefined,
  );
  const rows = await tx
    .select(listColumns)
    .from(parts)
    .leftJoin(partCategories, categoryJoin)
    .where(where)
    .orderBy(asc(parts.name), asc(parts.id))
    .limit(options.limit)
    .offset(options.offset);
  const [counted] = await tx.select({ total: count() }).from(parts).where(where);
  return { rows, total: counted?.total ?? 0 };
}

export async function findPart(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({
      part: parts,
      category: { id: partCategories.id, name: partCategories.name },
      // fornecedor apagado não aparece como preferido (o soft delete já limpa, isto é a rede)
      supplier: { id: suppliers.id, name: suppliers.name },
    })
    .from(parts)
    .leftJoin(partCategories, categoryJoin)
    .leftJoin(
      suppliers,
      and(
        eq(suppliers.organizationId, parts.organizationId),
        eq(suppliers.id, parts.preferredSupplierId),
        isNull(suppliers.deletedAt),
      ),
    )
    .where(and(active(organizationId), eq(parts.id, id)))
    .limit(1);
  return row;
}

/** O fornecedor existe nesta oficina e não foi tirado da lista? */
export async function findActiveSupplier(tx: Tx, organizationId: string, supplierId: string) {
  const [row] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)))
    .limit(1);
  return row;
}

/** Trava a peça: toda mudança de saldo passa por aqui, uma de cada vez. */
export async function lockPart(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(parts)
    .where(and(active(organizationId), eq(parts.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function insertPart(tx: Tx, values: typeof parts.$inferInsert) {
  const [row] = await tx.insert(parts).values(values).returning();
  return row!;
}

export async function updatePart(tx: Tx, id: string, patch: Partial<typeof parts.$inferInsert>) {
  await tx.update(parts).set(patch).where(eq(parts.id, id));
}

export async function softDeletePart(tx: Tx, id: string) {
  await tx.update(parts).set({ deletedAt: new Date() }).where(eq(parts.id, id));
}

// ---- categorias ----

export function listCategories(tx: Tx, organizationId: string) {
  return tx
    .select({
      id: partCategories.id,
      name: partCategories.name,
      partCount: sql<number>`(
        select count(*)::int from parts p
        where p.organization_id = part_categories.organization_id and p.category_id = part_categories.id and p.deleted_at is null
      )`,
    })
    .from(partCategories)
    .where(eq(partCategories.organizationId, organizationId))
    .orderBy(asc(partCategories.position), asc(partCategories.name));
}

export async function findCategory(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(partCategories)
    .where(and(eq(partCategories.organizationId, organizationId), eq(partCategories.id, id)))
    .limit(1);
  return row;
}

export async function insertCategory(tx: Tx, organizationId: string, name: string) {
  const [position] = await tx
    .select({ next: sql<number>`coalesce(max(${partCategories.position}), 0)::int + 1` })
    .from(partCategories)
    .where(eq(partCategories.organizationId, organizationId));
  const [row] = await tx
    .insert(partCategories)
    .values({ organizationId, name, position: position?.next ?? 1 })
    .returning();
  return row!;
}

export async function renameCategory(tx: Tx, id: string, name: string) {
  const [row] = await tx.update(partCategories).set({ name }).where(eq(partCategories.id, id)).returning();
  return row!;
}

// ---- aplicações ----

export function listApplications(tx: Tx, organizationId: string, partId: string) {
  return tx
    .select()
    .from(partApplications)
    .where(and(eq(partApplications.organizationId, organizationId), eq(partApplications.partId, partId)))
    .orderBy(asc(partApplications.make), asc(partApplications.model), asc(partApplications.yearFrom));
}

export async function insertApplication(tx: Tx, values: typeof partApplications.$inferInsert) {
  const [row] = await tx.insert(partApplications).values(values).returning();
  return row!;
}

export async function deleteApplication(tx: Tx, organizationId: string, partId: string, id: string) {
  const rows = await tx
    .delete(partApplications)
    .where(
      and(
        eq(partApplications.organizationId, organizationId),
        eq(partApplications.partId, partId),
        eq(partApplications.id, id),
      ),
    )
    .returning({ id: partApplications.id });
  return rows.length > 0;
}

// ---- movimentos e resumo ----

export async function insertMovement(tx: Tx, values: typeof inventoryMovements.$inferInsert) {
  const [row] = await tx.insert(inventoryMovements).values(values).returning();
  return row!;
}

export function listMovements(tx: Tx, organizationId: string, partId: string, limit: number) {
  return tx
    .select({
      id: inventoryMovements.id,
      type: inventoryMovements.type,
      quantity: inventoryMovements.quantity,
      unitCostCents: inventoryMovements.unitCostCents,
      balanceAfter: inventoryMovements.balanceAfter,
      reason: inventoryMovements.reason,
      createdByName: users.name,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .leftJoin(users, eq(users.id, inventoryMovements.createdBy))
    .where(and(eq(inventoryMovements.organizationId, organizationId), eq(inventoryMovements.partId, partId)))
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(limit);
}

export async function inventorySummary(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({
      tracked: sql<number>`(count(*) filter (where parts.track_stock))::int`,
      negative: sql<number>`(count(*) filter (where parts.track_stock and parts.quantity_on_hand < 0))::int`,
      out: sql<number>`(count(*) filter (
        where parts.track_stock and parts.quantity_on_hand >= 0 and parts.quantity_on_hand - parts.quantity_reserved <= 0
      ))::int`,
      low: sql<number>`(count(*) filter (
        where parts.track_stock and parts.quantity_on_hand - parts.quantity_reserved > 0
          and parts.quantity_on_hand - parts.quantity_reserved < parts.min_quantity
      ))::int`,
      value: sql<string>`coalesce(round(sum(greatest(parts.quantity_on_hand, 0) * coalesce(parts.average_cost_cents, 0))), 0)::bigint`,
    })
    .from(parts)
    .where(and(active(organizationId), eq(parts.isActive, true)));
  return row!;
}
