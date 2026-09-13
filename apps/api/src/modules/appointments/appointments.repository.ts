import { and, asc, eq, gt, lt, sql, type SQL } from 'drizzle-orm';
import { BLOCKING_APPOINTMENT_STATUSES, type AppointmentListQuery } from '@oficinaos/shared';
import {
  appointments,
  customers,
  memberships,
  organizations,
  services,
  users,
  vehicles,
  workOrders,
} from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type AppointmentRow = typeof appointments.$inferSelect;

const detalhes = {
  appointment: appointments,
  customerName: customers.name,
  customerPhone: customers.phone,
  customerWhatsapp: customers.whatsapp,
  vehicleMake: vehicles.make,
  vehicleModel: vehicles.model,
  vehiclePlate: vehicles.plate,
  mechanicName: users.name,
  mechanicColor: memberships.calendarColor,
  serviceName: services.name,
  workOrderNumber: workOrders.number,
};

export type AppointmentDetail = Awaited<ReturnType<typeof listAppointments>>[number];

/** Os mesmos joins para a lista e para o item: a agenda mostra tudo de uma vez. */
function comDetalhes(tx: Tx) {
  return tx
    .select(detalhes)
    .from(appointments)
    .innerJoin(
      customers,
      and(eq(customers.organizationId, appointments.organizationId), eq(customers.id, appointments.customerId)),
    )
    .leftJoin(
      vehicles,
      and(eq(vehicles.organizationId, appointments.organizationId), eq(vehicles.id, appointments.vehicleId)),
    )
    .leftJoin(
      memberships,
      and(
        eq(memberships.organizationId, appointments.organizationId),
        eq(memberships.userId, appointments.mechanicUserId),
      ),
    )
    .leftJoin(users, eq(users.id, appointments.mechanicUserId))
    .leftJoin(
      services,
      and(eq(services.organizationId, appointments.organizationId), eq(services.id, appointments.serviceId)),
    )
    .leftJoin(
      workOrders,
      and(eq(workOrders.organizationId, appointments.organizationId), eq(workOrders.id, appointments.workOrderId)),
    );
}

/**
 * O que aparece na janela da tela. A comparação é a mesma sobreposição
 * meio-aberta de `shared/calendar.ts`: quem termina exatamente quando a janela
 * começa ficou para trás.
 */
export function listAppointments(
  tx: Tx,
  organizationId: string,
  query: AppointmentListQuery & { from: string; to: string },
) {
  const conditions: SQL[] = [
    eq(appointments.organizationId, organizationId),
    lt(appointments.startsAt, new Date(query.to)),
    gt(appointments.endsAt, new Date(query.from)),
  ];
  if (query.mechanicId) conditions.push(eq(appointments.mechanicUserId, query.mechanicId));
  if (query.customerId) conditions.push(eq(appointments.customerId, query.customerId));
  if (query.vehicleId) conditions.push(eq(appointments.vehicleId, query.vehicleId));
  if (query.status) conditions.push(eq(appointments.status, query.status));
  return comDetalhes(tx).where(and(...conditions)).orderBy(asc(appointments.startsAt));
}

export async function findAppointment(tx: Tx, organizationId: string, id: string) {
  const [row] = await comDetalhes(tx)
    .where(and(eq(appointments.organizationId, organizationId), eq(appointments.id, id)))
    .limit(1);
  return row;
}

/** Trava o agendamento: duas pessoas remarcando o mesmo horário não se atropelam. */
export async function lockAppointment(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.organizationId, organizationId), eq(appointments.id, id)))
    .limit(1)
    .for('update');
  return row;
}

/**
 * Candidatos a conflito: tudo que aquele mecânico tem por perto do horário
 * pedido. Quem decide se conflita é `findConflicts` do shared — a regra do
 * intervalo meio-aberto mora num lugar só, e testada. A folga de 12 h é a
 * duração máxima de um agendamento, então nada que se sobreponha fica de fora.
 */
export function overlapCandidates(
  tx: Tx,
  organizationId: string,
  mechanicUserId: string,
  startsAt: Date,
  endsAt: Date,
) {
  const FOLGA_MS = 12 * 60 * 60 * 1000;
  return comDetalhes(tx)
    .where(
      and(
        eq(appointments.organizationId, organizationId),
        eq(appointments.mechanicUserId, mechanicUserId),
        lt(appointments.startsAt, new Date(endsAt.getTime() + FOLGA_MS)),
        gt(appointments.endsAt, new Date(startsAt.getTime() - FOLGA_MS)),
        sql`${appointments.status} in ${BLOCKING_APPOINTMENT_STATUSES}`,
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

export async function insertAppointment(tx: Tx, values: typeof appointments.$inferInsert) {
  const [row] = await tx.insert(appointments).values(values).returning();
  return row!;
}

export async function updateAppointment(tx: Tx, id: string, patch: Partial<typeof appointments.$inferInsert>) {
  const [row] = await tx.update(appointments).set(patch).where(eq(appointments.id, id)).returning();
  return row!;
}

/** A associação ativa daquele mecânico nesta oficina: existe e ainda trabalha aqui? */
export async function findActiveMember(tx: Tx, organizationId: string, userId: string) {
  const [row] = await tx
    .select({ userId: memberships.userId, isActive: memberships.isActive })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
    .limit(1);
  return row;
}


/** O fuso da oficina, para escrever horários nas mensagens de conflito e de aviso. */
export async function readTimezone(tx: Tx, organizationId: string): Promise<string> {
  const [row] = await tx
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.timezone ?? 'America/Sao_Paulo';
}
