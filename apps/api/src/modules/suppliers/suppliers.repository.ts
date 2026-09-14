import { and, asc, count, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { normalizeCnpj } from '@oficinaos/shared';
import { likeContains } from '../../core/normalize';
import { parts, suppliers } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type SupplierRow = typeof suppliers.$inferSelect;

// A subconsulta referencia a tabela externa pelo nome ESCRITO ("suppliers.id"):
// em consulta de uma tabela só, o Drizzle renderiza ${suppliers.id} como "id"
// sem qualificar, e o "id" passaria a ser o da peça (armadilha da E3).
const preferredPartCount = sql<number>`(
  select count(*)::int from parts p
  where p.organization_id = suppliers.organization_id
    and p.preferred_supplier_id = suppliers.id
    and p.deleted_at is null
)`;

/**
 * O que a pessoa digita pode ser o nome fantasia, a razão social, o nome do
 * vendedor, o CNPJ ou um pedaço do telefone. Tudo na mesma caixa, como no cliente.
 */
export function supplierMatches(q: string): SQL {
  const texto = likeContains(q);
  const conditions: SQL[] = [
    sql`immutable_unaccent(${suppliers.name}) ilike immutable_unaccent(${texto})`,
    sql`immutable_unaccent(coalesce(${suppliers.legalName}, '')) ilike immutable_unaccent(${texto})`,
    sql`immutable_unaccent(coalesce(${suppliers.contactName}, '')) ilike immutable_unaccent(${texto})`,
  ];
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 4) {
    conditions.push(sql`${suppliers.whatsapp} like ${`%${digits}%`}`, sql`${suppliers.phone} like ${`%${digits}%`}`);
  }
  const document = normalizeCnpj(q);
  if (document.length >= 3 && /\d/.test(document)) conditions.push(sql`${suppliers.document} like ${`${document}%`}`);
  return or(...conditions)!;
}

const ativo = (organizationId: string) =>
  and(eq(suppliers.organizationId, organizationId), isNull(suppliers.deletedAt));

export async function listSuppliers(
  tx: Tx,
  organizationId: string,
  options: { q?: string; category?: string; limit: number; offset: number },
) {
  const where = and(
    ativo(organizationId),
    options.q ? supplierMatches(options.q) : undefined,
    // categoria sem diferenciar maiúscula nem acento: "freios" acha "Freios"
    options.category
      ? sql`exists (
          select 1 from unnest(${suppliers.categories}) as c
          where immutable_unaccent(lower(c)) = immutable_unaccent(lower(${options.category}))
        )`
      : undefined,
  );
  const rows = await tx
    .select({ supplier: suppliers, preferredPartCount })
    .from(suppliers)
    .where(where)
    .orderBy(asc(suppliers.name), asc(suppliers.id))
    .limit(options.limit)
    .offset(options.offset);
  const [contagem] = await tx.select({ total: count() }).from(suppliers).where(where);
  return { rows, total: contagem?.total ?? 0 };
}

export async function findSupplier(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({ supplier: suppliers, preferredPartCount })
    .from(suppliers)
    .where(and(ativo(organizationId), eq(suppliers.id, id)))
    .limit(1);
  return row;
}

/** Trava o fornecedor: duas edições simultâneas não se atropelam. */
export async function lockSupplier(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(suppliers)
    .where(and(ativo(organizationId), eq(suppliers.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function insertSupplier(tx: Tx, values: typeof suppliers.$inferInsert) {
  const [row] = await tx.insert(suppliers).values(values).returning();
  return row!;
}

export async function updateSupplier(tx: Tx, id: string, patch: Partial<typeof suppliers.$inferInsert>) {
  const [row] = await tx.update(suppliers).set(patch).where(eq(suppliers.id, id)).returning();
  return row!;
}

/**
 * Tira da lista sem apagar: a compra antiga continua dizendo de quem foi. As
 * peças que o tinham como preferido ficam sem preferido — sugerir um fornecedor
 * que a oficina já descartou só atrapalharia a cotação.
 */
export async function softDeleteSupplier(tx: Tx, organizationId: string, id: string): Promise<number> {
  const liberadas = await tx
    .update(parts)
    .set({ preferredSupplierId: null })
    .where(and(eq(parts.organizationId, organizationId), eq(parts.preferredSupplierId, id)))
    .returning({ id: parts.id });
  await tx
    .update(suppliers)
    .set({ deletedAt: new Date() })
    .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.id, id)));
  return liberadas.length;
}
