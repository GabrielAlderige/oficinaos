import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  memberships,
  notifications,
  parts,
  partPriceHistory,
  supplierQuoteAwards,
  supplierQuoteInvites,
  supplierQuoteRequestItems,
  supplierQuoteRequests,
  supplierQuoteResponseItems,
  supplierQuoteResponses,
  suppliers,
  users,
  vehicles,
  workOrderItems,
  workOrders,
} from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type RequestRow = typeof supplierQuoteRequests.$inferSelect;
export type RequestItemRow = typeof supplierQuoteRequestItems.$inferSelect;
export type InviteRow = typeof supplierQuoteInvites.$inferSelect;
export type ResponseRow = typeof supplierQuoteResponses.$inferSelect;
export type ResponseItemRow = typeof supplierQuoteResponseItems.$inferSelect;

// ------------------------------- a cotação ----------------------------------

export async function insertRequest(tx: Tx, values: typeof supplierQuoteRequests.$inferInsert) {
  const [row] = await tx.insert(supplierQuoteRequests).values(values).returning();
  return row!;
}

export async function insertRequestItems(tx: Tx, values: (typeof supplierQuoteRequestItems.$inferInsert)[]) {
  return tx.insert(supplierQuoteRequestItems).values(values).returning();
}

export async function insertInvite(tx: Tx, values: typeof supplierQuoteInvites.$inferInsert) {
  const [row] = await tx.insert(supplierQuoteInvites).values(values).returning();
  return row!;
}

export async function findRequest(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({ request: supplierQuoteRequests, createdByName: users.name, workOrderNumber: workOrders.number })
    .from(supplierQuoteRequests)
    .leftJoin(users, eq(users.id, supplierQuoteRequests.createdBy))
    .leftJoin(
      workOrders,
      and(
        eq(workOrders.organizationId, supplierQuoteRequests.organizationId),
        eq(workOrders.id, supplierQuoteRequests.workOrderId),
      ),
    )
    .where(and(eq(supplierQuoteRequests.organizationId, organizationId), eq(supplierQuoteRequests.id, id)))
    .limit(1);
  return row;
}

/** Trava a cotação: escolher, cancelar e responder não se atropelam. */
export async function lockRequest(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(supplierQuoteRequests)
    .where(and(eq(supplierQuoteRequests.organizationId, organizationId), eq(supplierQuoteRequests.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function updateRequest(tx: Tx, id: string, patch: Partial<typeof supplierQuoteRequests.$inferInsert>) {
  const [row] = await tx.update(supplierQuoteRequests).set(patch).where(eq(supplierQuoteRequests.id, id)).returning();
  return row!;
}

export function listRequestItems(tx: Tx, organizationId: string, requestId: string) {
  return tx
    .select()
    .from(supplierQuoteRequestItems)
    .where(
      and(eq(supplierQuoteRequestItems.organizationId, organizationId), eq(supplierQuoteRequestItems.requestId, requestId)),
    )
    .orderBy(asc(supplierQuoteRequestItems.position));
}

/**
 * Para a decisão de preço: a margem da peça e como o item está hoje na OS
 * (preço de venda e se ainda é rascunho). Só vai para quem vê custo.
 */
export function listItemPricing(tx: Tx, organizationId: string, requestId: string) {
  return tx
    .select({
      requestItemId: supplierQuoteRequestItems.id,
      partMarkupBps: parts.markupBps,
      workOrderUnitPriceCents: workOrderItems.unitPriceCents,
      approvalStatus: workOrderItems.approvalStatus,
    })
    .from(supplierQuoteRequestItems)
    .leftJoin(parts, and(eq(parts.organizationId, supplierQuoteRequestItems.organizationId), eq(parts.id, supplierQuoteRequestItems.partId)))
    .leftJoin(
      workOrderItems,
      and(
        eq(workOrderItems.organizationId, supplierQuoteRequestItems.organizationId),
        eq(workOrderItems.id, supplierQuoteRequestItems.workOrderItemId),
      ),
    )
    .where(and(eq(supplierQuoteRequestItems.organizationId, organizationId), eq(supplierQuoteRequestItems.requestId, requestId)));
}

/** Os links, com o fornecedor — inclusive o que já saiu da lista: o histórico mostra de quem foi. */
export function listInvites(tx: Tx, organizationId: string, requestId: string) {
  return tx
    .select({
      invite: supplierQuoteInvites,
      supplier: {
        id: suppliers.id,
        name: suppliers.name,
        whatsapp: suppliers.whatsapp,
        contactName: suppliers.contactName,
        deletedAt: suppliers.deletedAt,
      },
    })
    .from(supplierQuoteInvites)
    .innerJoin(
      suppliers,
      and(eq(suppliers.organizationId, supplierQuoteInvites.organizationId), eq(suppliers.id, supplierQuoteInvites.supplierId)),
    )
    .where(and(eq(supplierQuoteInvites.organizationId, organizationId), eq(supplierQuoteInvites.requestId, requestId)))
    .orderBy(asc(suppliers.name));
}

export async function findInvite(tx: Tx, organizationId: string, inviteId: string) {
  const [row] = await tx
    .select()
    .from(supplierQuoteInvites)
    .where(and(eq(supplierQuoteInvites.organizationId, organizationId), eq(supplierQuoteInvites.id, inviteId)))
    .limit(1)
    .for('update');
  return row;
}

export async function updateInvite(tx: Tx, id: string, patch: Partial<typeof supplierQuoteInvites.$inferInsert>) {
  const [row] = await tx.update(supplierQuoteInvites).set(patch).where(eq(supplierQuoteInvites.id, id)).returning();
  return row!;
}

/** Todas as versões de todos os fornecedores da cotação, com as linhas. */
export async function listResponses(tx: Tx, organizationId: string, requestId: string) {
  const respostas = await tx
    .select({ response: supplierQuoteResponses, supplierId: supplierQuoteInvites.supplierId })
    .from(supplierQuoteResponses)
    .innerJoin(
      supplierQuoteInvites,
      and(
        eq(supplierQuoteInvites.organizationId, supplierQuoteResponses.organizationId),
        eq(supplierQuoteInvites.id, supplierQuoteResponses.inviteId),
      ),
    )
    .where(and(eq(supplierQuoteResponses.organizationId, organizationId), eq(supplierQuoteInvites.requestId, requestId)))
    .orderBy(asc(supplierQuoteResponses.inviteId), asc(supplierQuoteResponses.version));
  if (!respostas.length) return [];
  const linhas = await tx
    .select()
    .from(supplierQuoteResponseItems)
    .where(
      and(
        eq(supplierQuoteResponseItems.organizationId, organizationId),
        inArray(
          supplierQuoteResponseItems.responseId,
          respostas.map(({ response }) => response.id),
        ),
      ),
    );
  return respostas.map(({ response, supplierId }) => ({
    response,
    supplierId,
    items: linhas.filter((linha) => linha.responseId === response.id),
  }));
}

export function listAwards(tx: Tx, organizationId: string, requestId: string) {
  return tx
    .select({ award: supplierQuoteAwards, awardedByName: users.name })
    .from(supplierQuoteAwards)
    .innerJoin(
      supplierQuoteRequestItems,
      and(
        eq(supplierQuoteRequestItems.organizationId, supplierQuoteAwards.organizationId),
        eq(supplierQuoteRequestItems.id, supplierQuoteAwards.requestItemId),
      ),
    )
    .leftJoin(users, eq(users.id, supplierQuoteAwards.awardedBy))
    .where(and(eq(supplierQuoteAwards.organizationId, organizationId), eq(supplierQuoteRequestItems.requestId, requestId)));
}

/** Uma escolha por peça: mandar de novo troca a vencedora (o UNIQUE garante que nunca são duas). */
export async function upsertAward(tx: Tx, values: typeof supplierQuoteAwards.$inferInsert) {
  const [row] = await tx
    .insert(supplierQuoteAwards)
    .values(values)
    .onConflictDoUpdate({
      target: supplierQuoteAwards.requestItemId,
      set: { responseItemId: values.responseItemId, awardedBy: values.awardedBy, awardedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function insertPriceHistory(tx: Tx, values: (typeof partPriceHistory.$inferInsert)[]) {
  if (!values.length) return;
  await tx.insert(partPriceHistory).values(values);
}

export function listRequestsForWorkOrder(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select({
      request: supplierQuoteRequests,
      itemCount: sql<number>`(
        select count(*)::int from supplier_quote_request_items i
        where i.organization_id = supplier_quote_requests.organization_id and i.request_id = supplier_quote_requests.id
      )`,
      supplierCount: sql<number>`(
        select count(*)::int from supplier_quote_invites v
        where v.organization_id = supplier_quote_requests.organization_id and v.request_id = supplier_quote_requests.id
      )`,
      answeredCount: sql<number>`(
        select count(distinct r.invite_id)::int from supplier_quote_responses r
        join supplier_quote_invites v on v.id = r.invite_id and v.organization_id = r.organization_id
        where v.organization_id = supplier_quote_requests.organization_id and v.request_id = supplier_quote_requests.id
      )`,
    })
    .from(supplierQuoteRequests)
    .where(
      and(eq(supplierQuoteRequests.organizationId, organizationId), eq(supplierQuoteRequests.workOrderId, workOrderId)),
    )
    .orderBy(desc(supplierQuoteRequests.createdAt));
}

/**
 * OS cancelada cancela a cotação aberta (lição do conserto b9d1a36: orçamento de
 * OS cancelada seguia "aguardando"). Mora no repositório, e não no serviço, para
 * o serviço da OS chamar sem importar este módulo em círculo.
 */
export async function cancelOpenForWorkOrder(tx: Tx, organizationId: string, workOrderId: string): Promise<number> {
  const canceladas = await tx
    .update(supplierQuoteRequests)
    .set({ status: 'CANCELED', canceledAt: new Date(), cancelReason: 'OS cancelada' })
    .where(
      and(
        eq(supplierQuoteRequests.organizationId, organizationId),
        eq(supplierQuoteRequests.workOrderId, workOrderId),
        eq(supplierQuoteRequests.status, 'OPEN'),
      ),
    )
    .returning({ id: supplierQuoteRequests.id });
  return canceladas.length;
}

// ------------------------- o que vem da OS e do cadastro -------------------------

/** A OS com o carro inteiro — é o serviço que decide o que dele sai para o fornecedor. */
export async function findWorkOrderWithVehicle(tx: Tx, organizationId: string, workOrderId: string) {
  const [row] = await tx
    .select({
      order: { id: workOrders.id, number: workOrders.number, status: workOrders.status },
      vehicle: {
        make: vehicles.make,
        model: vehicles.model,
        version: vehicles.version,
        yearModel: vehicles.yearModel,
        yearManufacture: vehicles.yearManufacture,
        engine: vehicles.engine,
        vin: vehicles.vin,
        plate: vehicles.plate,
      },
    })
    .from(workOrders)
    .innerJoin(vehicles, and(eq(vehicles.organizationId, workOrders.organizationId), eq(vehicles.id, workOrders.vehicleId)))
    .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.id, workOrderId)))
    .limit(1);
  return row;
}

export function listWorkOrderItemsById(tx: Tx, organizationId: string, workOrderId: string, ids: readonly string[]) {
  return tx
    .select({ item: workOrderItems, unit: parts.unit })
    .from(workOrderItems)
    .leftJoin(parts, and(eq(parts.organizationId, workOrderItems.organizationId), eq(parts.id, workOrderItems.partId)))
    .where(
      and(
        eq(workOrderItems.organizationId, organizationId),
        eq(workOrderItems.workOrderId, workOrderId),
        inArray(workOrderItems.id, [...ids]),
      ),
    );
}

export function listActiveSuppliersById(tx: Tx, organizationId: string, ids: readonly string[]) {
  return tx
    .select({ id: suppliers.id, name: suppliers.name, whatsapp: suppliers.whatsapp, contactName: suppliers.contactName })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), inArray(suppliers.id, [...ids]), isNull(suppliers.deletedAt)));
}

export async function updateWorkOrderItemCost(tx: Tx, organizationId: string, itemId: string, unitCostCents: number) {
  await tx
    .update(workOrderItems)
    .set({ unitCostCents })
    .where(and(eq(workOrderItems.organizationId, organizationId), eq(workOrderItems.id, itemId)));
}

/** Quem da equipe recebe o aviso de resposta: quem pode pedir cotação. */
export function teamMembers(tx: Tx, organizationId: string) {
  return tx
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.isActive, true)));
}

export async function insertNotifications(tx: Tx, values: (typeof notifications.$inferInsert)[]) {
  if (!values.length) return;
  await tx.insert(notifications).values(values);
}

// ------------------------------ lado público --------------------------------

/**
 * A fase do token: com o HASH no contexto (`withSupplierToken`), a policy
 * `supplier_invite_by_token` libera exatamente uma linha. Daqui só sai a oficina
 * e o convite; todo o resto roda depois com contexto normal de oficina.
 */
export async function resolveInviteByHash(tx: Tx, tokenHash: string) {
  const [row] = await tx
    .select({
      id: supplierQuoteInvites.id,
      organizationId: supplierQuoteInvites.organizationId,
      requestId: supplierQuoteInvites.requestId,
      supplierId: supplierQuoteInvites.supplierId,
    })
    .from(supplierQuoteInvites)
    .where(eq(supplierQuoteInvites.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function findSupplierAnyState(tx: Tx, organizationId: string, supplierId: string) {
  const [row] = await tx
    .select({ id: suppliers.id, name: suppliers.name, deletedAt: suppliers.deletedAt })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.id, supplierId)))
    .limit(1);
  return row;
}

/** Só as versões DESTE fornecedor: a página pública nunca enxerga resposta de outro. */
export async function listResponsesOfInvite(tx: Tx, organizationId: string, inviteId: string) {
  const respostas = await tx
    .select()
    .from(supplierQuoteResponses)
    .where(and(eq(supplierQuoteResponses.organizationId, organizationId), eq(supplierQuoteResponses.inviteId, inviteId)))
    .orderBy(asc(supplierQuoteResponses.version));
  if (!respostas.length) return [];
  const linhas = await tx
    .select()
    .from(supplierQuoteResponseItems)
    .where(
      and(
        eq(supplierQuoteResponseItems.organizationId, organizationId),
        inArray(
          supplierQuoteResponseItems.responseId,
          respostas.map((resposta) => resposta.id),
        ),
      ),
    );
  return respostas.map((response) => ({ response, items: linhas.filter((linha) => linha.responseId === response.id) }));
}

export async function insertResponse(tx: Tx, values: typeof supplierQuoteResponses.$inferInsert) {
  const [row] = await tx.insert(supplierQuoteResponses).values(values).returning();
  return row!;
}

export async function insertResponseItems(tx: Tx, values: (typeof supplierQuoteResponseItems.$inferInsert)[]) {
  return tx.insert(supplierQuoteResponseItems).values(values).returning();
}
