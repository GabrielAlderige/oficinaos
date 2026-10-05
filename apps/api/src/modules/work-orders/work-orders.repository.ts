import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ACTIVE_WORK_ORDER_STATUSES, type WorkOrderStatus } from '@oficinaos/shared';
import { likeContains } from '../../core/normalize';
import {
  attachments,
  customers,
  messages,
  odometerReadings,
  organizations,
  parts,
  quotes,
  services,
  users,
  vehicleInspections,
  vehicles,
  workOrderEvents,
  workOrderItems,
  workOrders,
} from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type WorkOrderRow = typeof workOrders.$inferSelect;
export type WorkOrderItemRow = typeof workOrderItems.$inferSelect;

const advisor = alias(users, 'advisor_user');
const mechanic = alias(users, 'mechanic_user');
const itemMechanic = alias(users, 'item_mechanic_user');

const header = {
  order: workOrders,
  customer: { id: customers.id, name: customers.name, whatsapp: customers.whatsapp, phone: customers.phone },
  vehicle: {
    id: vehicles.id,
    plate: vehicles.plate,
    make: vehicles.make,
    model: vehicles.model,
    version: vehicles.version,
    yearManufacture: vehicles.yearManufacture,
    yearModel: vehicles.yearModel,
    odometerKm: vehicles.odometerKm,
  },
  advisorName: advisor.name,
  mechanicName: mechanic.name,
};

const withPeople = (tx: Tx) =>
  tx
    .select(header)
    .from(workOrders)
    .innerJoin(customers, and(eq(customers.organizationId, workOrders.organizationId), eq(customers.id, workOrders.customerId)))
    .innerJoin(vehicles, and(eq(vehicles.organizationId, workOrders.organizationId), eq(vehicles.id, workOrders.vehicleId)))
    .leftJoin(advisor, eq(advisor.id, workOrders.advisorUserId))
    .leftJoin(mechanic, eq(mechanic.id, workOrders.mechanicUserId));

export type WorkOrderHeader = Awaited<ReturnType<typeof withPeople>>[number];

export async function findWorkOrder(
  tx: Tx,
  organizationId: string,
  by: { id: string } | { number: number },
): Promise<WorkOrderHeader | undefined> {
  const [row] = await withPeople(tx)
    .where(
      and(
        eq(workOrders.organizationId, organizationId),
        'id' in by ? eq(workOrders.id, by.id) : eq(workOrders.number, by.number),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Trava a OS: toda mudança (itens, desconto, status) passa por aqui, para o
 * lock otimista de `version` não competir com duas transações ao mesmo tempo.
 */
export async function lockWorkOrder(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function insertWorkOrder(tx: Tx, values: typeof workOrders.$inferInsert) {
  const [row] = await tx.insert(workOrders).values(values).returning();
  return row!;
}

/** Nome e WhatsApp da oficina: é quem assina a mensagem do "veículo pronto". */
export async function findOrganization(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({ name: organizations.name, whatsapp: organizations.whatsapp })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row;
}

/**
 * Histórico de comunicação. O link `wa.me` não confirma entrega: o máximo que
 * sabemos é que a pessoa da oficina ABRIU o link (`LINK_OPENED`).
 */
export async function insertMessage(tx: Tx, values: typeof messages.$inferInsert) {
  const [row] = await tx.insert(messages).values(values).returning();
  return row!;
}

export async function updateWorkOrder(tx: Tx, id: string, patch: Partial<typeof workOrders.$inferInsert>) {
  const [row] = await tx.update(workOrders).set(patch).where(eq(workOrders.id, id)).returning();
  return row!;
}

export async function listWorkOrders(
  tx: Tx,
  organizationId: string,
  options: {
    q?: string;
    status: WorkOrderStatus | 'active' | 'all';
    mechanicId?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  },
) {
  const statusFilter: SQL | undefined =
    options.status === 'all'
      ? undefined
      : options.status === 'active'
        ? inArray(workOrders.status, [...ACTIVE_WORK_ORDER_STATUSES])
        : eq(workOrders.status, options.status);

  const where = and(
    eq(workOrders.organizationId, organizationId),
    statusFilter,
    options.mechanicId ? eq(workOrders.mechanicUserId, options.mechanicId) : undefined,
    options.from ? gte(workOrders.openedAt, options.from) : undefined,
    options.to ? lte(workOrders.openedAt, options.to) : undefined,
    options.q
      ? or(
          sql`work_orders.number::text = ${options.q.replace(/\D/g, '') || '-1'}`,
          sql`immutable_unaccent(customers.name) ilike immutable_unaccent(${likeContains(options.q)})`,
          sql`vehicles.plate_canonical like ${likeContains(options.q.toUpperCase().replace(/[^A-Z0-9]/g, ''))}`,
        )
      : undefined,
  );

  const rows = await withPeople(tx)
    .where(where)
    .orderBy(desc(workOrders.openedAt), desc(workOrders.number))
    .limit(options.limit)
    .offset(options.offset);

  const [counted] = await tx
    .select({ total: count() })
    .from(workOrders)
    .innerJoin(customers, and(eq(customers.organizationId, workOrders.organizationId), eq(customers.id, workOrders.customerId)))
    .innerJoin(vehicles, and(eq(vehicles.organizationId, workOrders.organizationId), eq(vehicles.id, workOrders.vehicleId)))
    .where(where);

  return { rows, total: counted?.total ?? 0 };
}

/**
 * Histórico de um carro ou de um cliente: as OS mais recentes primeiro, com os
 * itens que entraram (o recusado pelo cliente não foi feito, então fica fora).
 */
export async function listHistory(
  tx: Tx,
  organizationId: string,
  by: { vehicleId?: string; customerId?: string },
  limit: number,
) {
  const rows = await withPeople(tx)
    .where(
      and(
        eq(workOrders.organizationId, organizationId),
        by.vehicleId ? eq(workOrders.vehicleId, by.vehicleId) : undefined,
        by.customerId ? eq(workOrders.customerId, by.customerId) : undefined,
      ),
    )
    .orderBy(desc(workOrders.openedAt), desc(workOrders.number))
    .limit(limit);

  const ids = rows.map((row) => row.order.id);
  const items = ids.length
    ? await tx
        .select({
          workOrderId: workOrderItems.workOrderId,
          type: workOrderItems.type,
          description: workOrderItems.description,
          quantity: workOrderItems.quantity,
        })
        .from(workOrderItems)
        .where(
          and(
            eq(workOrderItems.organizationId, organizationId),
            inArray(workOrderItems.workOrderId, ids),
            sql`${workOrderItems.approvalStatus} <> 'REJECTED'`,
          ),
        )
        .orderBy(asc(workOrderItems.position), asc(workOrderItems.createdAt))
    : [];
  return { rows, items };
}

/** Contagem por status para o quadro da oficina. */
export async function countByStatus(tx: Tx, organizationId: string) {
  return tx
    .select({ status: workOrders.status, total: count() })
    .from(workOrders)
    .where(eq(workOrders.organizationId, organizationId))
    .groupBy(workOrders.status);
}

export async function countItems(tx: Tx, organizationId: string, workOrderIds: string[]) {
  if (!workOrderIds.length) return [];
  return tx
    .select({ workOrderId: workOrderItems.workOrderId, total: count() })
    .from(workOrderItems)
    .where(and(eq(workOrderItems.organizationId, organizationId), inArray(workOrderItems.workOrderId, workOrderIds)))
    .groupBy(workOrderItems.workOrderId);
}

// -------------------------------- itens --------------------------------

/** `available` é o disponível da peça agora (em estoque − reservado). */
export function listItems(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select({
      item: workOrderItems,
      mechanicName: itemMechanic.name,
      partOnHand: parts.quantityOnHand,
      partReserved: parts.quantityReserved,
    })
    .from(workOrderItems)
    .leftJoin(itemMechanic, eq(itemMechanic.id, workOrderItems.mechanicUserId))
    .leftJoin(parts, and(eq(parts.organizationId, workOrderItems.organizationId), eq(parts.id, workOrderItems.partId)))
    .where(and(eq(workOrderItems.organizationId, organizationId), eq(workOrderItems.workOrderId, workOrderId)))
    .orderBy(asc(workOrderItems.position), asc(workOrderItems.createdAt));
}

export async function findItem(tx: Tx, organizationId: string, workOrderId: string, itemId: string) {
  const [row] = await tx
    .select()
    .from(workOrderItems)
    .where(
      and(
        eq(workOrderItems.organizationId, organizationId),
        eq(workOrderItems.workOrderId, workOrderId),
        eq(workOrderItems.id, itemId),
      ),
    )
    .limit(1);
  return row;
}

export async function insertItem(tx: Tx, values: typeof workOrderItems.$inferInsert) {
  const [row] = await tx.insert(workOrderItems).values(values).returning();
  return row!;
}

export async function updateItem(tx: Tx, id: string, patch: Partial<typeof workOrderItems.$inferInsert>) {
  await tx.update(workOrderItems).set(patch).where(eq(workOrderItems.id, id));
}

export async function deleteItem(tx: Tx, id: string) {
  await tx.delete(workOrderItems).where(eq(workOrderItems.id, id));
}

export async function nextItemPosition(tx: Tx, organizationId: string, workOrderId: string) {
  const [row] = await tx
    .select({ next: sql<number>`coalesce(max(${workOrderItems.position}), 0)::int + 1` })
    .from(workOrderItems)
    .where(and(eq(workOrderItems.organizationId, organizationId), eq(workOrderItems.workOrderId, workOrderId)));
  return row?.next ?? 1;
}

/** O orçamento mais recente da OS: é ele que a tela mostra (enviado ou decidido). */
export async function findCurrentQuote(tx: Tx, organizationId: string, workOrderId: string) {
  const [row] = await tx
    .select({
      id: quotes.id,
      number: quotes.number,
      status: quotes.status,
      totalCents: quotes.totalCents,
      validUntil: quotes.validUntil,
    })
    .from(quotes)
    .where(and(eq(quotes.organizationId, organizationId), eq(quotes.workOrderId, workOrderId)))
    .orderBy(desc(quotes.version))
    .limit(1);
  return row;
}

// ------------------------- timeline e inspeções -------------------------

/**
 * O mesmo POST repetido pela rede não pode jogar o pacote duas vezes na OS
 * (D32). A marca fica no próprio evento da timeline — não há tabela de
 * requisição para item de OS, e criar uma para isto seria tabela nova para
 * guardar um uuid.
 */
export async function findEventByClientRequest(
  tx: Tx,
  organizationId: string,
  workOrderId: string,
  clientRequestId: string,
) {
  const [row] = await tx
    .select({ id: workOrderEvents.id })
    .from(workOrderEvents)
    .where(
      and(
        eq(workOrderEvents.organizationId, organizationId),
        eq(workOrderEvents.workOrderId, workOrderId),
        sql`${workOrderEvents.data}->>'clientRequestId' = ${clientRequestId}`,
      ),
    )
    .limit(1);
  return row;
}

export async function insertEvent(tx: Tx, values: typeof workOrderEvents.$inferInsert) {
  const [row] = await tx.insert(workOrderEvents).values(values).returning();
  return row!;
}

export function listEvents(tx: Tx, organizationId: string, workOrderId: string, limit: number) {
  return tx
    .select({
      id: workOrderEvents.id,
      type: workOrderEvents.type,
      data: workOrderEvents.data,
      actorType: workOrderEvents.actorType,
      actorName: users.name,
      createdAt: workOrderEvents.createdAt,
    })
    .from(workOrderEvents)
    .leftJoin(users, eq(users.id, workOrderEvents.actorUserId))
    .where(and(eq(workOrderEvents.organizationId, organizationId), eq(workOrderEvents.workOrderId, workOrderId)))
    .orderBy(desc(workOrderEvents.createdAt))
    .limit(limit);
}

export async function insertInspection(tx: Tx, values: typeof vehicleInspections.$inferInsert) {
  const [row] = await tx.insert(vehicleInspections).values(values).returning();
  return row!;
}

export function listInspections(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select({ inspection: vehicleInspections, performedByName: users.name })
    .from(vehicleInspections)
    .leftJoin(users, eq(users.id, vehicleInspections.performedBy))
    .where(and(eq(vehicleInspections.organizationId, organizationId), eq(vehicleInspections.workOrderId, workOrderId)))
    .orderBy(asc(vehicleInspections.performedAt));
}

/**
 * Os anexos de uma inspeção (E28): a assinatura e as fotos da entrega. Só o
 * que terminou de subir — anexo pendente é arquivo que ainda não existe.
 */
export function listInspectionAttachments(tx: Tx, organizationId: string, inspectionIds: string[]) {
  return tx
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.organizationId, organizationId),
        inArray(attachments.inspectionId, inspectionIds),
        eq(attachments.status, 'READY'),
        isNull(attachments.deletedAt),
      ),
    )
    .orderBy(asc(attachments.createdAt));
}

/** Pendura anexos já enviados na inspeção que acabou de nascer. */
export async function attachToInspection(
  tx: Tx,
  organizationId: string,
  inspectionId: string,
  attachmentIds: string[],
) {
  if (!attachmentIds.length) return [];
  return tx
    .update(attachments)
    .set({ inspectionId })
    .where(
      and(
        eq(attachments.organizationId, organizationId),
        inArray(attachments.id, attachmentIds),
        isNull(attachments.deletedAt),
      ),
    )
    .returning({ id: attachments.id });
}

/** Marca a aprovação de itens da OS. Usado ao pular o orçamento (E34). */
export async function setItemsApproval(
  tx: Tx,
  organizationId: string,
  itemIds: string[],
  approvalStatus: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED',
) {
  if (!itemIds.length) return;
  await tx
    .update(workOrderItems)
    .set({ approvalStatus })
    .where(and(eq(workOrderItems.organizationId, organizationId), inArray(workOrderItems.id, itemIds)));
}

// --------------------------- catálogo (preço) ---------------------------

export async function findServiceForItem(tx: Tx, organizationId: string, serviceId: string) {
  const [row] = await tx
    .select()
    .from(services)
    .where(and(eq(services.organizationId, organizationId), eq(services.id, serviceId)))
    .limit(1);
  return row;
}

/** Trava o veículo antes de mexer no km: o cache é atualizado na mesma transação. */
export async function lockVehicleOdometer(tx: Tx, organizationId: string, vehicleId: string) {
  const [row] = await tx
    .select({ id: vehicles.id, odometerKm: vehicles.odometerKm })
    .from(vehicles)
    .where(and(eq(vehicles.organizationId, organizationId), eq(vehicles.id, vehicleId)))
    .limit(1)
    .for('update');
  return row;
}

export async function updateVehicleOdometer(tx: Tx, vehicleId: string, km: number) {
  await tx.update(vehicles).set({ odometerKm: km, odometerUpdatedAt: new Date() }).where(eq(vehicles.id, vehicleId));
}

/** Histórico de km: é a base de "troca de óleo há 8.000 km". */
export async function insertOdometerReading(tx: Tx, values: typeof odometerReadings.$inferInsert) {
  await tx.insert(odometerReadings).values(values);
}

/**
 * O veículo com o dono atual: a FK composta garante que é da mesma oficina, não
 * que é do cliente informado na abertura da OS.
 */
export async function findVehicleWithCustomer(tx: Tx, organizationId: string, vehicleId: string) {
  const [row] = await tx
    .select({
      id: vehicles.id,
      customerId: vehicles.customerId,
      odometerKm: vehicles.odometerKm,
      deletedAt: vehicles.deletedAt,
    })
    .from(vehicles)
    .where(and(eq(vehicles.organizationId, organizationId), eq(vehicles.id, vehicleId)))
    .limit(1);
  return row;
}

export async function findPartForItem(tx: Tx, organizationId: string, partId: string) {
  const [row] = await tx
    .select()
    .from(parts)
    .where(and(eq(parts.organizationId, organizationId), eq(parts.id, partId)))
    .limit(1);
  return row;
}
