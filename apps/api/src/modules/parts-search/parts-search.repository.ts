import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { likeContains } from '../../core/normalize';
import {
  partOffers,
  partSearchQueries,
  supplierPriceListItems,
  suppliers,
  vehicles,
} from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type PartOfferRow = typeof partOffers.$inferSelect;

export async function insertQuery(tx: Tx, values: typeof partSearchQueries.$inferInsert) {
  const [row] = await tx.insert(partSearchQueries).values(values).returning();
  return row!;
}

export async function insertOffers(tx: Tx, values: (typeof partOffers.$inferInsert)[]) {
  if (!values.length) return [];
  return tx.insert(partOffers).values(values).returning();
}

export async function findOffer(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({ offer: partOffers, supplierName: suppliers.name })
    .from(partOffers)
    .leftJoin(suppliers, and(eq(suppliers.organizationId, partOffers.organizationId), eq(suppliers.id, partOffers.supplierId)))
    .where(and(eq(partOffers.organizationId, organizationId), eq(partOffers.id, id)))
    .limit(1);
  return row;
}

export async function offersOfQuery(tx: Tx, organizationId: string, queryId: string) {
  return tx
    .select({ offer: partOffers, supplierName: suppliers.name })
    .from(partOffers)
    .leftJoin(suppliers, and(eq(suppliers.organizationId, partOffers.organizationId), eq(suppliers.id, partOffers.supplierId)))
    .where(and(eq(partOffers.organizationId, organizationId), eq(partOffers.queryId, queryId)))
    .orderBy(asc(partOffers.position));
}

export async function findVehicle(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({
      id: vehicles.id,
      make: vehicles.make,
      model: vehicles.model,
      yearModel: vehicles.yearModel,
      plate: vehicles.plate,
    })
    .from(vehicles)
    .where(and(eq(vehicles.organizationId, organizationId), eq(vehicles.id, id), isNull(vehicles.deletedAt)))
    .limit(1);
  return row;
}

// ------------------------- lista de preço do fornecedor -------------------------

export async function findSupplier(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.id, id), isNull(suppliers.deletedAt)))
    .limit(1);
  return row;
}

export async function listPriceListItems(
  tx: Tx,
  organizationId: string,
  supplierId: string,
  options: { q?: string; limit: number; offset: number },
) {
  const padrao = options.q ? likeContains(options.q) : null;
  const where = and(
    eq(supplierPriceListItems.organizationId, organizationId),
    eq(supplierPriceListItems.supplierId, supplierId),
    padrao
      ? sql`(immutable_unaccent(${supplierPriceListItems.name}) ilike immutable_unaccent(${padrao})
             or ${supplierPriceListItems.code} ilike ${padrao})`
      : undefined,
  );
  const rows = await tx
    .select()
    .from(supplierPriceListItems)
    .where(where)
    .orderBy(asc(supplierPriceListItems.name))
    .limit(options.limit)
    .offset(options.offset);
  const [total] = await tx.select({ total: count() }).from(supplierPriceListItems).where(where);
  const [ultima] = await tx
    .select({ importedAt: supplierPriceListItems.updatedAt, createdAt: supplierPriceListItems.createdAt })
    .from(supplierPriceListItems)
    .where(and(eq(supplierPriceListItems.organizationId, organizationId), eq(supplierPriceListItems.supplierId, supplierId)))
    .orderBy(desc(supplierPriceListItems.createdAt))
    .limit(1);
  return { rows, total: total?.total ?? 0, importedAt: ultima?.importedAt ?? ultima?.createdAt ?? null };
}

export async function upsertPriceListItem(tx: Tx, values: typeof supplierPriceListItems.$inferInsert) {
  // sem código, não há como casar a linha com a importação anterior: entra nova
  if (!values.code) {
    await tx.insert(supplierPriceListItems).values(values);
    return 'inserted' as const;
  }
  const [existente] = await tx
    .select({ id: supplierPriceListItems.id })
    .from(supplierPriceListItems)
    .where(
      and(
        eq(supplierPriceListItems.organizationId, values.organizationId),
        eq(supplierPriceListItems.supplierId, values.supplierId),
        sql`lower(${supplierPriceListItems.code}) = lower(${values.code})`,
      ),
    )
    .limit(1);
  if (existente) {
    await tx
      .update(supplierPriceListItems)
      .set({
        name: values.name,
        brand: values.brand,
        priceCents: values.priceCents,
        unit: values.unit,
        importBatch: values.importBatch,
      })
      .where(eq(supplierPriceListItems.id, existente.id));
    return 'updated' as const;
  }
  await tx.insert(supplierPriceListItems).values(values);
  return 'inserted' as const;
}

/** "Trocar a lista inteira": o que não veio nesta importação sai. */
export async function deleteItemsOutsideBatch(
  tx: Tx,
  organizationId: string,
  supplierId: string,
  batch: string,
): Promise<number> {
  const removidos = await tx
    .delete(supplierPriceListItems)
    .where(
      and(
        eq(supplierPriceListItems.organizationId, organizationId),
        eq(supplierPriceListItems.supplierId, supplierId),
        sql`${supplierPriceListItems.importBatch} <> ${batch}`,
      ),
    )
    .returning({ id: supplierPriceListItems.id });
  return removidos.length;
}

export async function countPriceListItems(tx: Tx, organizationId: string, supplierIds: string[]) {
  if (!supplierIds.length) return new Map<string, number>();
  const rows = await tx
    .select({ supplierId: supplierPriceListItems.supplierId, total: count() })
    .from(supplierPriceListItems)
    .where(
      and(
        eq(supplierPriceListItems.organizationId, organizationId),
        inArray(supplierPriceListItems.supplierId, supplierIds),
      ),
    )
    .groupBy(supplierPriceListItems.supplierId);
  return new Map(rows.map((row) => [row.supplierId, row.total]));
}
