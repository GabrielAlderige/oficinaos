import { and, desc, eq, sql } from 'drizzle-orm';
import { charges, customers, paymentWebhookEvents, workOrders } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type ChargeRow = typeof charges.$inferSelect;

export async function insertCharge(tx: Tx, values: typeof charges.$inferInsert): Promise<ChargeRow> {
  const [row] = await tx.insert(charges).values(values).returning();
  return row!;
}

export async function updateCharge(tx: Tx, id: string, patch: Partial<typeof charges.$inferInsert>): Promise<ChargeRow> {
  const [row] = await tx.update(charges).set(patch).where(eq(charges.id, id)).returning();
  return row!;
}

/** Trava a cobrança: dois avisos do gateway ao mesmo tempo não dão baixa duas vezes. */
export async function lockCharge(tx: Tx, organizationId: string, id: string): Promise<ChargeRow | undefined> {
  const [row] = await tx
    .select()
    .from(charges)
    .where(and(eq(charges.organizationId, organizationId), eq(charges.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function findByClientRequest(
  tx: Tx,
  organizationId: string,
  clientRequestId: string,
): Promise<ChargeRow | undefined> {
  const [row] = await tx
    .select()
    .from(charges)
    .where(and(eq(charges.organizationId, organizationId), eq(charges.clientRequestId, clientRequestId)))
    .limit(1);
  return row;
}

/**
 * A cobrança pela referência do gateway. Roda com a **capacidade** do webhook
 * (`withChargeRef`), quando ainda não se sabe de que oficina é o dinheiro.
 */
export async function findByProviderRef(tx: Tx, providerChargeId: string): Promise<ChargeRow | undefined> {
  const [row] = await tx.select().from(charges).where(eq(charges.providerChargeId, providerChargeId)).limit(1);
  return row;
}

const listagem = (tx: Tx) =>
  tx
    .select({ charge: charges, workOrderNumber: workOrders.number, customerName: customers.name })
    .from(charges)
    .innerJoin(workOrders, and(eq(workOrders.organizationId, charges.organizationId), eq(workOrders.id, charges.workOrderId)))
    .innerJoin(customers, and(eq(customers.organizationId, charges.organizationId), eq(customers.id, charges.customerId)));

export type ChargeJoinedRow = Awaited<ReturnType<typeof listagem>>[number];

export async function listByWorkOrder(tx: Tx, organizationId: string, workOrderId: string): Promise<ChargeJoinedRow[]> {
  return listagem(tx)
    .where(and(eq(charges.organizationId, organizationId), eq(charges.workOrderId, workOrderId)))
    .orderBy(desc(charges.createdAt));
}

export async function findCharge(tx: Tx, organizationId: string, id: string): Promise<ChargeJoinedRow | undefined> {
  const [row] = await listagem(tx)
    .where(and(eq(charges.organizationId, organizationId), eq(charges.id, id)))
    .limit(1);
  return row;
}

/** Quanto já está pendurado em cobrança ABERTA nesta OS. */
export async function pendingCents(tx: Tx, organizationId: string, workOrderId: string): Promise<number> {
  const { rows } = await tx.execute<{ total: string }>(sql`
    select coalesce(sum(amount_cents), 0)::text as total
    from charges
    where organization_id = ${organizationId} and work_order_id = ${workOrderId} and status = 'PENDING'
  `);
  return Number(rows[0]?.total ?? 0);
}

/** O cliente já tem cadastro no gateway? Reaproveitar evita cliente duplicado lá. */
export async function findProviderCustomerId(
  tx: Tx,
  organizationId: string,
  customerId: string,
  provider: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ providerCustomerId: charges.providerCustomerId })
    .from(charges)
    .where(
      and(
        eq(charges.organizationId, organizationId),
        eq(charges.customerId, customerId),
        eq(charges.provider, provider),
      ),
    )
    .orderBy(desc(charges.createdAt))
    .limit(1);
  return row?.providerCustomerId ?? null;
}

/**
 * Registra o aviso do gateway. Devolve `false` quando ele JÁ tinha sido
 * processado — o gateway reenvia o mesmo aviso até receber 200, e sem esta
 * trava o reenvio daria baixa duas vezes no mesmo dinheiro.
 */
export async function registrarAviso(
  tx: Tx,
  values: typeof paymentWebhookEvents.$inferInsert,
): Promise<boolean> {
  const inseridos = await tx.insert(paymentWebhookEvents).values(values).onConflictDoNothing().returning();
  return inseridos.length > 0;
}
