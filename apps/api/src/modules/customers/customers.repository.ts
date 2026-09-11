import { and, asc, count, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { canonicalPlatePrefix, normalizeCnpj } from '@oficinaos/shared';
import { likeContains } from '../../core/normalize';
import { customers, vehicles } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type CustomerRow = typeof customers.$inferSelect;

// As subconsultas referenciam a tabela externa por nome ESCRITO ("customers.id"): em consulta
// de uma tabela só, o Drizzle renderiza ${customers.id} como "id" sem qualificar, e aí o "id"
// dentro da subconsulta passa a ser o do veículo. Os testes de contagem e placas pegam isso.
const vehicleCount = sql<number>`(
  select count(*)::int from vehicles v
  where v.organization_id = customers.organization_id and v.customer_id = customers.id and v.deleted_at is null
)`;

const plates = sql<string[]>`array(
  select v.plate from vehicles v
  where v.organization_id = customers.organization_id and v.customer_id = customers.id
    and v.deleted_at is null and v.plate is not null
  order by v.created_at limit 3
)`;

/**
 * O que a atendente digita pode ser nome (sem acento), telefone, documento ou
 * placa de um carro do cliente. Tudo cabe na mesma caixa de busca.
 */
export function customerMatches(q: string): SQL {
  const conditions: SQL[] = [sql`immutable_unaccent(${customers.name}) ilike immutable_unaccent(${likeContains(q)})`];
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 4) {
    conditions.push(sql`${customers.whatsapp} like ${`%${digits}%`}`, sql`${customers.phone} like ${`%${digits}%`}`);
  }
  const document = normalizeCnpj(q);
  if (document.length >= 3 && /\d/.test(document)) conditions.push(sql`${customers.document} like ${`${document}%`}`);
  const plate = canonicalPlatePrefix(q);
  if (plate) {
    conditions.push(sql`exists (
      select 1 from vehicles v
      where v.organization_id = customers.organization_id and v.customer_id = customers.id
        and v.deleted_at is null and v.plate_canonical like ${`${plate}%`}
    )`);
  }
  return or(...conditions)!;
}

const listColumns = {
  id: customers.id,
  type: customers.type,
  name: customers.name,
  document: customers.document,
  whatsapp: customers.whatsapp,
  phone: customers.phone,
  createdAt: customers.createdAt,
  vehicleCount,
  plates,
};

export async function listCustomers(
  tx: Tx,
  organizationId: string,
  options: { q?: string; limit: number; offset: number },
) {
  const where = and(
    eq(customers.organizationId, organizationId),
    isNull(customers.deletedAt),
    options.q ? customerMatches(options.q) : undefined,
  );
  const rows = await tx
    .select(listColumns)
    .from(customers)
    .where(where)
    .orderBy(asc(customers.name), asc(customers.id))
    .limit(options.limit)
    .offset(options.offset);
  const [counted] = await tx.select({ total: count() }).from(customers).where(where);
  return { rows, total: counted?.total ?? 0 };
}

export async function findCustomer(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({ customer: customers, vehicleCount })
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), eq(customers.id, id), isNull(customers.deletedAt)))
    .limit(1);
  return row;
}

export async function lockCustomer(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), eq(customers.id, id), isNull(customers.deletedAt)))
    .limit(1)
    .for('update');
  return row;
}

export async function countVehicles(tx: Tx, organizationId: string, customerId: string) {
  const [row] = await tx
    .select({ total: count() })
    .from(vehicles)
    .where(
      and(eq(vehicles.organizationId, organizationId), eq(vehicles.customerId, customerId), isNull(vehicles.deletedAt)),
    );
  return row?.total ?? 0;
}

export async function insertCustomer(tx: Tx, values: typeof customers.$inferInsert) {
  const [row] = await tx.insert(customers).values(values).returning();
  return row!;
}

export async function updateCustomer(tx: Tx, id: string, patch: Partial<typeof customers.$inferInsert>) {
  const [row] = await tx.update(customers).set(patch).where(eq(customers.id, id)).returning();
  return row!;
}

/** Apaga (soft) o cliente e os veículos dele. O histórico de atendimentos continua referenciando as linhas. */
export async function softDeleteCustomer(tx: Tx, organizationId: string, id: string) {
  const now = new Date();
  await tx.update(customers).set({ deletedAt: now }).where(eq(customers.id, id));
  const removed = await tx
    .update(vehicles)
    .set({ deletedAt: now })
    .where(and(eq(vehicles.organizationId, organizationId), eq(vehicles.customerId, id), isNull(vehicles.deletedAt)))
    .returning({ id: vehicles.id });
  return removed.length;
}

export async function searchCustomers(tx: Tx, organizationId: string, q: string, limit: number) {
  return tx
    .select({
      id: customers.id,
      type: customers.type,
      name: customers.name,
      whatsapp: customers.whatsapp,
      vehicleCount,
    })
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), isNull(customers.deletedAt), customerMatches(q)))
    .orderBy(asc(customers.name))
    .limit(limit);
}
