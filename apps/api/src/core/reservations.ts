import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { milliToDecimal, parseQuantity } from '@oficinaos/shared';
import { parts, workOrderItems } from '../db/schema';
import type { Tx } from '../db/tenant';

const milli = (value: string) => parseQuantity(value) ?? 0;

export interface ReservationSummary {
  /** itens que ficaram com a peça inteira reservada */
  reserved: number;
  /** itens que reservaram só parte: falta peça para terminar o serviço */
  partial: { itemId: string; description: string; missingMilli: number }[];
}

/**
 * Reserva o estoque dos itens aprovados (docs/ARCHITECTURE.md §10).
 *
 * Reserva `min(quantidade, disponível)` e marca `RESERVED` ou `PARTIAL`. Faltar
 * peça **não** trava a aprovação: o cliente já disse sim, e travar aqui faria a
 * oficina aprovar por fora do sistema. O que falta vira alerta na OS.
 *
 * Só item de peça com origem `STOCK` mexe no estoque: peça do cliente e peça a
 * comprar não têm saldo para reservar.
 */
export async function reserveApprovedItems(
  tx: Tx,
  organizationId: string,
  itemIds: string[],
): Promise<ReservationSummary> {
  const summary: ReservationSummary = { reserved: 0, partial: [] };
  if (!itemIds.length) return summary;

  const items = await tx
    .select()
    .from(workOrderItems)
    .where(
      and(
        eq(workOrderItems.organizationId, organizationId),
        inArray(workOrderItems.id, itemIds),
        eq(workOrderItems.type, 'PART'),
        eq(workOrderItems.sourcing, 'STOCK'),
        isNotNull(workOrderItems.partId),
      ),
    );
  if (!items.length) return summary;

  // ordem fixa de id evita deadlock quando duas aprovações pegam as mesmas peças
  const partIds = [...new Set(items.map((item) => item.partId!))].sort();
  const locked = await tx
    .select()
    .from(parts)
    .where(and(eq(parts.organizationId, organizationId), inArray(parts.id, partIds)))
    .orderBy(asc(parts.id))
    .for('update');

  const saldo = new Map(
    locked.map((part) => [
      part.id,
      { trackStock: part.trackStock, available: milli(part.quantityOnHand) - milli(part.quantityReserved), reservedTotal: milli(part.quantityReserved) },
    ]),
  );

  for (const item of items) {
    const part = saldo.get(item.partId!);
    if (!part || !part.trackStock) continue;

    const requested = milli(item.quantity);
    const canReserve = Math.max(0, Math.min(requested, part.available));
    part.available -= canReserve;
    part.reservedTotal += canReserve;

    const status = canReserve >= requested ? 'RESERVED' : canReserve > 0 ? 'PARTIAL' : 'NONE';
    await tx
      .update(workOrderItems)
      .set({ stockStatus: status, reservedQuantity: milliToDecimal(canReserve) })
      .where(eq(workOrderItems.id, item.id));

    if (status === 'RESERVED') summary.reserved += 1;
    else summary.partial.push({ itemId: item.id, description: item.description, missingMilli: requested - canReserve });
  }

  for (const [partId, part] of saldo) {
    await tx.update(parts).set({ quantityReserved: milliToDecimal(part.reservedTotal) }).where(eq(parts.id, partId));
  }
  return summary;
}

/**
 * Devolve ao estoque o que estava reservado (OS cancelada, item removido ou
 * orçamento recusado). Some da reserva da peça e o item vira `RELEASED`.
 */
export async function releaseReservations(tx: Tx, organizationId: string, itemIds: string[]): Promise<void> {
  if (!itemIds.length) return;

  const items = await tx
    .select()
    .from(workOrderItems)
    .where(
      and(
        eq(workOrderItems.organizationId, organizationId),
        inArray(workOrderItems.id, itemIds),
        inArray(workOrderItems.stockStatus, ['RESERVED', 'PARTIAL']),
        isNotNull(workOrderItems.partId),
      ),
    );
  if (!items.length) return;

  const partIds = [...new Set(items.map((item) => item.partId!))].sort();
  const locked = await tx
    .select()
    .from(parts)
    .where(and(eq(parts.organizationId, organizationId), inArray(parts.id, partIds)))
    .orderBy(asc(parts.id))
    .for('update');

  const reservado = new Map(locked.map((part) => [part.id, milli(part.quantityReserved)]));

  for (const item of items) {
    const atual = reservado.get(item.partId!);
    if (atual === undefined) continue;
    // nunca deixa a reserva negativa, mesmo se algo já tiver sido devolvido
    reservado.set(item.partId!, Math.max(0, atual - milli(item.reservedQuantity)));
    await tx
      .update(workOrderItems)
      .set({ stockStatus: 'RELEASED', reservedQuantity: milliToDecimal(0) })
      .where(eq(workOrderItems.id, item.id));
  }

  for (const [partId, total] of reservado) {
    await tx.update(parts).set({ quantityReserved: milliToDecimal(total) }).where(eq(parts.id, partId));
  }
}
