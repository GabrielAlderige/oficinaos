import { and, asc, count, desc, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { canonicalPlatePrefix } from '@oficinaos/shared';
import { likeContains } from '../../core/normalize';
import { customers, odometerReadings, users, vehicles } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type VehicleRow = typeof vehicles.$inferSelect;

/** Dono do veículo: o join usa o par (oficina, id), como a FK composta. */
const ownerJoin = and(eq(customers.organizationId, vehicles.organizationId), eq(customers.id, vehicles.customerId));

const listColumns = {
  id: vehicles.id,
  plate: vehicles.plate,
  make: vehicles.make,
  model: vehicles.model,
  version: vehicles.version,
  yearManufacture: vehicles.yearManufacture,
  yearModel: vehicles.yearModel,
  odometerKm: vehicles.odometerKm,
  customer: { id: customers.id, name: customers.name },
};

/** Placa (antiga ou Mercosul, pelo prefixo canônico), marca/modelo ou nome do dono. */
export function vehicleMatches(q: string): SQL {
  const conditions: SQL[] = [
    sql`immutable_unaccent(${vehicles.make} || ' ' || ${vehicles.model}) ilike immutable_unaccent(${likeContains(q)})`,
    sql`immutable_unaccent(${customers.name}) ilike immutable_unaccent(${likeContains(q)})`,
  ];
  const plate = canonicalPlatePrefix(q);
  if (plate) conditions.push(sql`${vehicles.plateCanonical} like ${`${plate}%`}`);
  return or(...conditions)!;
}

const active = (organizationId: string) => and(eq(vehicles.organizationId, organizationId), isNull(vehicles.deletedAt));

export async function listVehicles(
  tx: Tx,
  organizationId: string,
  options: { q?: string; customerId?: string; limit: number; offset: number },
) {
  const where = and(
    active(organizationId),
    options.customerId ? eq(vehicles.customerId, options.customerId) : undefined,
    options.q ? vehicleMatches(options.q) : undefined,
  );
  const rows = await tx
    .select(listColumns)
    .from(vehicles)
    .innerJoin(customers, ownerJoin)
    .where(where)
    .orderBy(desc(vehicles.createdAt), asc(vehicles.id))
    .limit(options.limit)
    .offset(options.offset);
  const [counted] = await tx.select({ total: count() }).from(vehicles).innerJoin(customers, ownerJoin).where(where);
  return { rows, total: counted?.total ?? 0 };
}

export function listByCustomer(tx: Tx, organizationId: string, customerId: string) {
  return tx
    .select(listColumns)
    .from(vehicles)
    .innerJoin(customers, ownerJoin)
    .where(and(active(organizationId), eq(vehicles.customerId, customerId)))
    .orderBy(asc(vehicles.createdAt));
}

/** Busca instantânea por placa: o prefixo já vem canônico ("ABC12" → "ABC1C"). */
export function lookupByPlatePrefix(tx: Tx, organizationId: string, prefix: string, limit: number) {
  return tx
    .select(listColumns)
    .from(vehicles)
    .innerJoin(customers, ownerJoin)
    .where(and(active(organizationId), sql`${vehicles.plateCanonical} like ${`${prefix}%`}`))
    .orderBy(asc(vehicles.plateCanonical))
    .limit(limit);
}

export function searchVehicles(tx: Tx, organizationId: string, q: string, limit: number) {
  return tx
    .select(listColumns)
    .from(vehicles)
    .innerJoin(customers, ownerJoin)
    .where(and(active(organizationId), vehicleMatches(q)))
    .orderBy(asc(vehicles.plateCanonical))
    .limit(limit);
}

export async function findVehicle(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({ vehicle: vehicles, owner: { id: customers.id, name: customers.name, whatsapp: customers.whatsapp } })
    .from(vehicles)
    .innerJoin(customers, ownerJoin)
    .where(and(active(organizationId), eq(vehicles.id, id)))
    .limit(1);
  return row;
}

export async function lockVehicle(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(vehicles)
    .where(and(active(organizationId), eq(vehicles.id, id)))
    .limit(1)
    .for('update');
  return row;
}

/** Outro veículo ativo com a mesma placa (canônica), com o nome do dono para a mensagem. */
export async function findByCanonicalPlate(tx: Tx, organizationId: string, canonical: string, exceptId?: string) {
  const [row] = await tx
    .select({ id: vehicles.id, plate: vehicles.plate, customerName: customers.name })
    .from(vehicles)
    .innerJoin(customers, ownerJoin)
    .where(
      and(
        active(organizationId),
        eq(vehicles.plateCanonical, canonical),
        exceptId ? ne(vehicles.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return row;
}

export async function findActiveCustomer(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), eq(customers.id, id), isNull(customers.deletedAt)))
    .limit(1);
  return row;
}

export async function insertVehicle(tx: Tx, values: typeof vehicles.$inferInsert) {
  const [row] = await tx.insert(vehicles).values(values).returning();
  return row!;
}

export async function updateVehicle(tx: Tx, id: string, patch: Partial<typeof vehicles.$inferInsert>) {
  await tx.update(vehicles).set(patch).where(eq(vehicles.id, id));
}

export async function softDeleteVehicle(tx: Tx, id: string) {
  await tx.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, id));
}

export async function insertReading(tx: Tx, values: typeof odometerReadings.$inferInsert) {
  await tx.insert(odometerReadings).values(values);
}

export function listReadings(tx: Tx, organizationId: string, vehicleId: string) {
  return tx
    .select({
      id: odometerReadings.id,
      km: odometerReadings.km,
      source: odometerReadings.source,
      recordedByName: users.name,
      recordedAt: odometerReadings.recordedAt,
    })
    .from(odometerReadings)
    .leftJoin(users, eq(users.id, odometerReadings.recordedBy))
    .where(and(eq(odometerReadings.organizationId, organizationId), eq(odometerReadings.vehicleId, vehicleId)))
    .orderBy(desc(odometerReadings.recordedAt))
    .limit(50);
}
