import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { PurchaseOrderListQuery } from '@oficinaos/shared';
import {
  inventoryMovements,
  partPriceHistory,
  parts,
  purchaseOrderItems,
  purchaseOrders,
  purchaseReceiptItems,
  purchaseReceipts,
  purchaseReturnItems,
  purchaseReturns,
  suppliers,
  supplierQuoteInvites,
  supplierQuoteRequests,
  users,
  vehicles,
  workOrderItems,
  workOrders,
} from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderItemRow = typeof purchaseOrderItems.$inferSelect;

const criadoPor = sql<string | null>`(select name from users u where u.id = ${purchaseOrders.createdBy})`;
const pedidoPor = sql<string | null>`(select name from users u where u.id = ${purchaseOrders.orderedBy})`;

// -------------------------------- o pedido ----------------------------------

export async function insertOrder(tx: Tx, values: typeof purchaseOrders.$inferInsert) {
  const [row] = await tx.insert(purchaseOrders).values(values).returning();
  return row!;
}

export async function updateOrder(tx: Tx, id: string, values: Partial<typeof purchaseOrders.$inferInsert>) {
  await tx.update(purchaseOrders).set(values).where(eq(purchaseOrders.id, id));
}

/** Trava o pedido: edição, pedido, recebimento e cancelamento não se cruzam. */
export async function lockOrder(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function findOrder(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({
      order: purchaseOrders,
      supplier: {
        id: suppliers.id,
        name: suppliers.name,
        whatsapp: suppliers.whatsapp,
        contactName: suppliers.contactName,
        deletedAt: suppliers.deletedAt,
      },
      quoteNumber: supplierQuoteRequests.number,
      createdByName: criadoPor,
      orderedByName: pedidoPor,
    })
    .from(purchaseOrders)
    .innerJoin(
      suppliers,
      and(eq(suppliers.organizationId, purchaseOrders.organizationId), eq(suppliers.id, purchaseOrders.supplierId)),
    )
    .leftJoin(
      supplierQuoteRequests,
      and(
        eq(supplierQuoteRequests.organizationId, purchaseOrders.organizationId),
        eq(supplierQuoteRequests.id, purchaseOrders.supplierQuoteRequestId),
      ),
    )
    .where(and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.id, id)))
    .limit(1);
  return row;
}

/** As linhas, com a unidade da peça e a OS para a qual cada uma foi comprada. */
export function listLines(tx: Tx, organizationId: string, orderId: string) {
  return tx
    .select({
      line: purchaseOrderItems,
      unit: parts.unit,
      workOrder: { id: workOrders.id, number: workOrders.number },
      vehicle: { make: vehicles.make, model: vehicles.model, plate: vehicles.plate },
    })
    .from(purchaseOrderItems)
    .innerJoin(parts, and(eq(parts.organizationId, purchaseOrderItems.organizationId), eq(parts.id, purchaseOrderItems.partId)))
    .leftJoin(
      workOrderItems,
      and(
        eq(workOrderItems.organizationId, purchaseOrderItems.organizationId),
        eq(workOrderItems.id, purchaseOrderItems.workOrderItemId),
      ),
    )
    .leftJoin(workOrders, and(eq(workOrders.organizationId, workOrderItems.organizationId), eq(workOrders.id, workOrderItems.workOrderId)))
    .leftJoin(vehicles, and(eq(vehicles.organizationId, workOrders.organizationId), eq(vehicles.id, workOrders.vehicleId)))
    .where(and(eq(purchaseOrderItems.organizationId, organizationId), eq(purchaseOrderItems.purchaseOrderId, orderId)))
    .orderBy(asc(purchaseOrderItems.position));
}

export async function replaceLines(tx: Tx, organizationId: string, orderId: string, values: (typeof purchaseOrderItems.$inferInsert)[]) {
  await tx
    .delete(purchaseOrderItems)
    .where(and(eq(purchaseOrderItems.organizationId, organizationId), eq(purchaseOrderItems.purchaseOrderId, orderId)));
  if (values.length) await tx.insert(purchaseOrderItems).values(values);
}

export async function listOrders(tx: Tx, organizationId: string, query: PurchaseOrderListQuery) {
  const conditions: SQL[] = [eq(purchaseOrders.organizationId, organizationId)];
  if (query.status === 'open') conditions.push(inArray(purchaseOrders.status, ['DRAFT', 'ORDERED', 'PARTIAL']));
  else if (query.status !== 'all') conditions.push(eq(purchaseOrders.status, query.status));
  if (query.supplierId) conditions.push(eq(purchaseOrders.supplierId, query.supplierId));
  const termo = query.q?.trim();
  if (termo) {
    const numero = /^\d{1,9}$/.test(termo) ? Number(termo) : null;
    conditions.push(
      numero !== null
        ? sql`(${purchaseOrders.number} = ${numero} or immutable_unaccent(${suppliers.name}) ilike immutable_unaccent(${`%${termo}%`}))`
        : sql`immutable_unaccent(${suppliers.name}) ilike immutable_unaccent(${`%${termo}%`})`,
    );
  }
  const where = and(...conditions);

  const linhas = sql`(select count(*)::int from purchase_order_items i where i.organization_id = ${purchaseOrders.organizationId} and i.purchase_order_id = ${purchaseOrders.id})`;
  // mesma conta de `lineValueCents`: quantidade × custo, meio centavo para cima
  const valor = sql`(select coalesce(sum(round(i.quantity * i.unit_cost_cents)), 0)::bigint from purchase_order_items i where i.organization_id = ${purchaseOrders.organizationId} and i.purchase_order_id = ${purchaseOrders.id})`;
  const oss = sql`(select coalesce(array_agg(distinct w.number order by w.number), '{}') from purchase_order_items i
      join work_order_items wi on wi.organization_id = i.organization_id and wi.id = i.work_order_item_id
      join work_orders w on w.organization_id = wi.organization_id and w.id = wi.work_order_id
      where i.organization_id = ${purchaseOrders.organizationId} and i.purchase_order_id = ${purchaseOrders.id})`;

  const [rows, [total]] = [
    await tx
      .select({
        order: purchaseOrders,
        supplierName: suppliers.name,
        itemCount: sql<number>`${linhas}`,
        itemsTotalCents: sql<string>`${valor}`,
        workOrderNumbers: sql<number[]>`${oss}`,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, and(eq(suppliers.organizationId, purchaseOrders.organizationId), eq(suppliers.id, purchaseOrders.supplierId)))
      .where(where)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .innerJoin(suppliers, and(eq(suppliers.organizationId, purchaseOrders.organizationId), eq(suppliers.id, purchaseOrders.supplierId)))
      .where(where),
  ];
  return { rows, total: total?.count ?? 0 };
}

// ------------------------------- conferências -------------------------------

export async function findSupplier(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      whatsapp: suppliers.whatsapp,
      contactName: suppliers.contactName,
      deletedAt: suppliers.deletedAt,
    })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.id, id)))
    .limit(1);
  return row;
}

export function listPartsById(tx: Tx, organizationId: string, ids: readonly string[]) {
  if (!ids.length) return Promise.resolve([]);
  return tx
    .select({ id: parts.id, name: parts.name, manufacturerCode: parts.manufacturerCode, unit: parts.unit })
    .from(parts)
    .where(and(eq(parts.organizationId, organizationId), inArray(parts.id, [...ids]), isNull(parts.deletedAt)));
}

/** Os itens de OS que alguém quer comprar, com a situação da OS. */
export function listWorkOrderItemsForPurchase(tx: Tx, organizationId: string, ids: readonly string[]) {
  if (!ids.length) return Promise.resolve([]);
  return tx
    .select({
      id: workOrderItems.id,
      type: workOrderItems.type,
      partId: workOrderItems.partId,
      sourcing: workOrderItems.sourcing,
      stockStatus: workOrderItems.stockStatus,
      workOrderId: workOrders.id,
      workOrderNumber: workOrders.number,
      workOrderStatus: workOrders.status,
    })
    .from(workOrderItems)
    .innerJoin(workOrders, and(eq(workOrders.organizationId, workOrderItems.organizationId), eq(workOrders.id, workOrderItems.workOrderId)))
    .where(and(eq(workOrderItems.organizationId, organizationId), inArray(workOrderItems.id, [...ids])));
}

/**
 * Linhas em pedidos que não foram cancelados. É o que impede comprar duas vezes
 * a mesma peça da OS, ou transformar a mesma escolha da cotação em dois pedidos.
 */
export function listActiveLines(
  tx: Tx,
  organizationId: string,
  by: { workOrderItemIds: readonly string[] } | { awardIds: readonly string[] },
  exceptOrderId?: string,
) {
  const alvo =
    'workOrderItemIds' in by
      ? by.workOrderItemIds.length
        ? inArray(purchaseOrderItems.workOrderItemId, [...by.workOrderItemIds])
        : null
      : by.awardIds.length
        ? inArray(purchaseOrderItems.supplierQuoteAwardId, [...by.awardIds])
        : null;
  if (!alvo) return Promise.resolve([]);
  return tx
    .select({
      workOrderItemId: purchaseOrderItems.workOrderItemId,
      awardId: purchaseOrderItems.supplierQuoteAwardId,
      orderId: purchaseOrders.id,
      orderNumber: purchaseOrders.number,
    })
    .from(purchaseOrderItems)
    .innerJoin(
      purchaseOrders,
      and(eq(purchaseOrders.organizationId, purchaseOrderItems.organizationId), eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId)),
    )
    .where(
      and(
        eq(purchaseOrderItems.organizationId, organizationId),
        alvo,
        ne(purchaseOrders.status, 'CANCELED'),
        exceptOrderId ? ne(purchaseOrders.id, exceptOrderId) : undefined,
      ),
    );
}

/** O que foi comprado para uma OS: aparece na ficha dela. */
export function listLinesForWorkOrder(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select({
      line: purchaseOrderItems,
      order: { id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, expectedOn: purchaseOrders.expectedOn },
      supplierName: suppliers.name,
    })
    .from(purchaseOrderItems)
    .innerJoin(
      purchaseOrders,
      and(eq(purchaseOrders.organizationId, purchaseOrderItems.organizationId), eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId)),
    )
    .innerJoin(suppliers, and(eq(suppliers.organizationId, purchaseOrders.organizationId), eq(suppliers.id, purchaseOrders.supplierId)))
    .innerJoin(
      workOrderItems,
      and(eq(workOrderItems.organizationId, purchaseOrderItems.organizationId), eq(workOrderItems.id, purchaseOrderItems.workOrderItemId)),
    )
    .where(and(eq(purchaseOrderItems.organizationId, organizationId), eq(workOrderItems.workOrderId, workOrderId)))
    .orderBy(desc(purchaseOrders.createdAt), asc(purchaseOrderItems.position));
}

// ---------------------------- recebimento e devolução -----------------------

export async function findReceiptByClientRequest(tx: Tx, organizationId: string, clientRequestId: string) {
  const [row] = await tx
    .select({ id: purchaseReceipts.id, purchaseOrderId: purchaseReceipts.purchaseOrderId })
    .from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.organizationId, organizationId), eq(purchaseReceipts.clientRequestId, clientRequestId)))
    .limit(1);
  return row;
}

export async function findReturnByClientRequest(tx: Tx, organizationId: string, clientRequestId: string) {
  const [row] = await tx
    .select({ id: purchaseReturns.id, purchaseOrderId: purchaseReturns.purchaseOrderId })
    .from(purchaseReturns)
    .where(and(eq(purchaseReturns.organizationId, organizationId), eq(purchaseReturns.clientRequestId, clientRequestId)))
    .limit(1);
  return row;
}

export async function insertReceipt(tx: Tx, values: typeof purchaseReceipts.$inferInsert) {
  const [row] = await tx.insert(purchaseReceipts).values(values).returning();
  return row!;
}

export async function insertReceiptItem(tx: Tx, values: typeof purchaseReceiptItems.$inferInsert) {
  await tx.insert(purchaseReceiptItems).values(values);
}

export async function insertReturn(tx: Tx, values: typeof purchaseReturns.$inferInsert) {
  const [row] = await tx.insert(purchaseReturns).values(values).returning();
  return row!;
}

export async function insertReturnItem(tx: Tx, values: typeof purchaseReturnItems.$inferInsert) {
  await tx.insert(purchaseReturnItems).values(values);
}

export async function updateLine(tx: Tx, id: string, values: Partial<typeof purchaseOrderItems.$inferInsert>) {
  await tx.update(purchaseOrderItems).set(values).where(eq(purchaseOrderItems.id, id));
}

export async function listReceipts(tx: Tx, organizationId: string, orderId: string) {
  const recebimentos = await tx
    .select({ receipt: purchaseReceipts, receivedByName: users.name })
    .from(purchaseReceipts)
    .leftJoin(users, eq(users.id, purchaseReceipts.receivedBy))
    .where(and(eq(purchaseReceipts.organizationId, organizationId), eq(purchaseReceipts.purchaseOrderId, orderId)))
    .orderBy(asc(purchaseReceipts.receivedAt), asc(purchaseReceipts.id));
  if (!recebimentos.length) return [];
  const itens = await tx
    .select({ item: purchaseReceiptItems, description: purchaseOrderItems.description })
    .from(purchaseReceiptItems)
    .innerJoin(
      purchaseOrderItems,
      and(
        eq(purchaseOrderItems.organizationId, purchaseReceiptItems.organizationId),
        eq(purchaseOrderItems.id, purchaseReceiptItems.purchaseOrderItemId),
      ),
    )
    .where(
      and(
        eq(purchaseReceiptItems.organizationId, organizationId),
        inArray(
          purchaseReceiptItems.receiptId,
          recebimentos.map(({ receipt }) => receipt.id),
        ),
      ),
    )
    .orderBy(asc(purchaseOrderItems.position));
  return recebimentos.map((r) => ({ ...r, items: itens.filter(({ item }) => item.receiptId === r.receipt.id) }));
}

export async function listReturns(tx: Tx, organizationId: string, orderId: string) {
  const devolucoes = await tx
    .select({ ret: purchaseReturns, returnedByName: users.name })
    .from(purchaseReturns)
    .leftJoin(users, eq(users.id, purchaseReturns.returnedBy))
    .where(and(eq(purchaseReturns.organizationId, organizationId), eq(purchaseReturns.purchaseOrderId, orderId)))
    .orderBy(asc(purchaseReturns.returnedAt), asc(purchaseReturns.id));
  if (!devolucoes.length) return [];
  const itens = await tx
    .select({ item: purchaseReturnItems, description: purchaseOrderItems.description })
    .from(purchaseReturnItems)
    .innerJoin(
      purchaseOrderItems,
      and(
        eq(purchaseOrderItems.organizationId, purchaseReturnItems.organizationId),
        eq(purchaseOrderItems.id, purchaseReturnItems.purchaseOrderItemId),
      ),
    )
    .where(
      and(
        eq(purchaseReturnItems.organizationId, organizationId),
        inArray(
          purchaseReturnItems.returnId,
          devolucoes.map(({ ret }) => ret.id),
        ),
      ),
    )
    .orderBy(asc(purchaseOrderItems.position));
  return devolucoes.map((d) => ({ ...d, items: itens.filter(({ item }) => item.returnId === d.ret.id) }));
}

/**
 * Quanto entrou de cada linha e a que custo (com frete), somando os
 * recebimentos: a devolução sai pelo custo médio DAS ENTRADAS daquela linha.
 */
export function landedCostsByLine(tx: Tx, organizationId: string, orderId: string) {
  return tx
    .select({
      purchaseOrderItemId: purchaseReceiptItems.purchaseOrderItemId,
      quantity: sql<string>`sum(${purchaseReceiptItems.quantity})`,
      value: sql<string>`sum(${purchaseReceiptItems.quantity} * ${purchaseReceiptItems.landedUnitCostCents})`,
    })
    .from(purchaseReceiptItems)
    .innerJoin(
      purchaseReceipts,
      and(eq(purchaseReceipts.organizationId, purchaseReceiptItems.organizationId), eq(purchaseReceipts.id, purchaseReceiptItems.receiptId)),
    )
    .where(and(eq(purchaseReceiptItems.organizationId, organizationId), eq(purchaseReceipts.purchaseOrderId, orderId)))
    .groupBy(purchaseReceiptItems.purchaseOrderItemId);
}

/** Trava as peças em ordem de id: dois recebimentos das mesmas peças não travam um ao outro. */
export function lockParts(tx: Tx, organizationId: string, ids: readonly string[]) {
  if (!ids.length) return Promise.resolve([]);
  return tx
    .select()
    .from(parts)
    .where(and(eq(parts.organizationId, organizationId), inArray(parts.id, [...ids])))
    .orderBy(asc(parts.id))
    .for('update');
}

export async function updatePart(tx: Tx, id: string, values: Partial<typeof parts.$inferInsert>) {
  await tx.update(parts).set(values).where(eq(parts.id, id));
}

export async function insertMovement(tx: Tx, values: typeof inventoryMovements.$inferInsert) {
  const [row] = await tx.insert(inventoryMovements).values(values).returning({ id: inventoryMovements.id });
  return row!;
}

export async function insertPriceHistory(tx: Tx, values: (typeof partPriceHistory.$inferInsert)[]) {
  if (values.length) await tx.insert(partPriceHistory).values(values);
}

/** Itens de OS que recebem peça, travados, com a situação da OS. */
export function lockWorkOrderItems(tx: Tx, organizationId: string, ids: readonly string[]) {
  if (!ids.length) return Promise.resolve([]);
  return tx
    .select({
      item: workOrderItems,
      workOrder: { id: workOrders.id, number: workOrders.number, status: workOrders.status },
    })
    .from(workOrderItems)
    .innerJoin(workOrders, and(eq(workOrders.organizationId, workOrderItems.organizationId), eq(workOrders.id, workOrderItems.workOrderId)))
    .where(and(eq(workOrderItems.organizationId, organizationId), inArray(workOrderItems.id, [...ids])))
    .orderBy(asc(workOrderItems.id))
    .for('update', { of: workOrderItems });
}

export async function updateWorkOrderItem(tx: Tx, id: string, values: Partial<typeof workOrderItems.$inferInsert>) {
  await tx.update(workOrderItems).set(values).where(eq(workOrderItems.id, id));
}

// ------------------------- sugestão de compra e históricos -------------------

/**
 * Peças com estoque mínimo e o que já está vindo para o estoque (pedidos vivos,
 * sem OS): a regra de quanto repor mora no shared (`suggestedRestockMilli`).
 */
export function listRestockCandidates(tx: Tx, organizationId: string) {
  const vindo = sql<string>`(
    select coalesce(sum(greatest(i.quantity - (i.received_quantity - i.returned_quantity), 0)), 0)
    from purchase_order_items i
    join purchase_orders o on o.organization_id = i.organization_id and o.id = i.purchase_order_id
    where i.organization_id = ${parts.organizationId}
      and i.part_id = ${parts.id}
      and i.work_order_item_id is null
      and o.status in ('DRAFT', 'ORDERED', 'PARTIAL')
  )`;
  return tx
    .select({
      part: {
        id: parts.id,
        name: parts.name,
        manufacturerCode: parts.manufacturerCode,
        unit: parts.unit,
        quantityOnHand: parts.quantityOnHand,
        quantityReserved: parts.quantityReserved,
        minQuantity: parts.minQuantity,
        lastCostCents: parts.lastCostCents,
        averageCostCents: parts.averageCostCents,
      },
      supplier: { id: suppliers.id, name: suppliers.name },
      incoming: vindo,
    })
    .from(parts)
    .leftJoin(
      suppliers,
      and(eq(suppliers.organizationId, parts.organizationId), eq(suppliers.id, parts.preferredSupplierId), isNull(suppliers.deletedAt)),
    )
    .where(
      and(
        eq(parts.organizationId, organizationId),
        isNull(parts.deletedAt),
        eq(parts.isActive, true),
        eq(parts.trackStock, true),
        sql`${parts.minQuantity} > 0`,
      ),
    )
    .orderBy(asc(parts.name));
}

/**
 * Peças que OS em andamento esperam e que ninguém pediu ainda: marcadas
 * "Comprar", ou "Do estoque" aprovadas que não conseguiram reserva inteira.
 */
export function listWorkOrderCandidates(tx: Tx, organizationId: string) {
  return tx
    .select({
      item: {
        id: workOrderItems.id,
        quantity: workOrderItems.quantity,
        reservedQuantity: workOrderItems.reservedQuantity,
        sourcing: workOrderItems.sourcing,
        approvalStatus: workOrderItems.approvalStatus,
      },
      workOrderNumber: workOrders.number,
      part: {
        id: parts.id,
        name: parts.name,
        manufacturerCode: parts.manufacturerCode,
        unit: parts.unit,
        lastCostCents: parts.lastCostCents,
        averageCostCents: parts.averageCostCents,
      },
      supplier: { id: suppliers.id, name: suppliers.name },
    })
    .from(workOrderItems)
    .innerJoin(workOrders, and(eq(workOrders.organizationId, workOrderItems.organizationId), eq(workOrders.id, workOrderItems.workOrderId)))
    .innerJoin(parts, and(eq(parts.organizationId, workOrderItems.organizationId), eq(parts.id, workOrderItems.partId)))
    .leftJoin(
      suppliers,
      and(eq(suppliers.organizationId, parts.organizationId), eq(suppliers.id, parts.preferredSupplierId), isNull(suppliers.deletedAt)),
    )
    .where(
      and(
        eq(workOrderItems.organizationId, organizationId),
        eq(workOrderItems.type, 'PART'),
        isNull(parts.deletedAt),
        ne(workOrderItems.stockStatus, 'CONSUMED'),
        ne(workOrderItems.approvalStatus, 'REJECTED'),
        sql`${workOrders.status} not in ('DELIVERED', 'CANCELED')`,
        sql`(
          ${workOrderItems.sourcing} = 'TO_ORDER'
          or (${workOrderItems.sourcing} = 'STOCK' and ${workOrderItems.approvalStatus} = 'APPROVED' and ${parts.trackStock}
              and ${workOrderItems.reservedQuantity} < ${workOrderItems.quantity})
        )`,
        sql`not exists (
          select 1 from purchase_order_items i
          join purchase_orders o on o.organization_id = i.organization_id and o.id = i.purchase_order_id
          where i.organization_id = ${workOrderItems.organizationId}
            and i.work_order_item_id = ${workOrderItems.id}
            and o.status <> 'CANCELED'
        )`,
      ),
    )
    .orderBy(asc(workOrders.number), asc(workOrderItems.position));
}

export function listSupplierQuotesFor(tx: Tx, organizationId: string, supplierId: string, limit: number) {
  return tx
    .select({
      id: supplierQuoteRequests.id,
      number: supplierQuoteRequests.number,
      status: supplierQuoteRequests.status,
      createdAt: supplierQuoteRequests.createdAt,
      workOrderNumber: workOrders.number,
      answered: sql<boolean>`exists (
        select 1 from supplier_quote_responses r
        where r.organization_id = ${supplierQuoteInvites.organizationId} and r.invite_id = ${supplierQuoteInvites.id}
      )`,
    })
    .from(supplierQuoteInvites)
    .innerJoin(
      supplierQuoteRequests,
      and(
        eq(supplierQuoteRequests.organizationId, supplierQuoteInvites.organizationId),
        eq(supplierQuoteRequests.id, supplierQuoteInvites.requestId),
      ),
    )
    .leftJoin(
      workOrders,
      and(eq(workOrders.organizationId, supplierQuoteRequests.organizationId), eq(workOrders.id, supplierQuoteRequests.workOrderId)),
    )
    .where(and(eq(supplierQuoteInvites.organizationId, organizationId), eq(supplierQuoteInvites.supplierId, supplierId)))
    .orderBy(desc(supplierQuoteRequests.createdAt))
    .limit(limit);
}

export function listPriceHistory(tx: Tx, organizationId: string, partId: string, limit: number) {
  return tx
    .select({
      history: partPriceHistory,
      supplier: { id: suppliers.id, name: suppliers.name },
      purchaseOrderNumber: purchaseOrders.number,
      quoteNumber: supplierQuoteRequests.number,
      quoteWorkOrderNumber: workOrders.number,
    })
    .from(partPriceHistory)
    .leftJoin(suppliers, and(eq(suppliers.organizationId, partPriceHistory.organizationId), eq(suppliers.id, partPriceHistory.supplierId)))
    .leftJoin(
      purchaseOrders,
      and(eq(purchaseOrders.organizationId, partPriceHistory.organizationId), eq(purchaseOrders.id, partPriceHistory.purchaseOrderId)),
    )
    .leftJoin(
      supplierQuoteRequests,
      and(
        eq(supplierQuoteRequests.organizationId, partPriceHistory.organizationId),
        eq(supplierQuoteRequests.id, partPriceHistory.supplierQuoteRequestId),
      ),
    )
    .leftJoin(
      workOrders,
      and(eq(workOrders.organizationId, supplierQuoteRequests.organizationId), eq(workOrders.id, supplierQuoteRequests.workOrderId)),
    )
    .where(and(eq(partPriceHistory.organizationId, organizationId), eq(partPriceHistory.partId, partId)))
    .orderBy(desc(partPriceHistory.capturedAt), desc(partPriceHistory.id))
    .limit(limit);
}

export async function partExists(tx: Tx, organizationId: string, partId: string) {
  const [row] = await tx.select({ id: parts.id }).from(parts).where(and(eq(parts.organizationId, organizationId), eq(parts.id, partId))).limit(1);
  return Boolean(row);
}
