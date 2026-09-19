import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { milliToDecimal, parseQuantity, weightedAverageCost } from '@oficinaos/shared';
import { inventoryMovements, parts, workOrderItems } from '../db/schema';
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

export interface ConsumptionSummary {
  /** itens que saíram do estoque de verdade */
  consumed: number;
  /** peças que ficaram negativas: a oficina precisa acertar a contagem */
  negative: { partId: string; name: string; balanceMilli: number }[];
}

/**
 * Devolução ao estoque de peça que JÁ foi baixada (E17, `CUSTOMER_RETURN`).
 *
 * Acontece quando a oficina reabre a OS e tira a peça (ou reduz a quantidade):
 * a peça não foi para o carro, então volta para a prateleira. Antes isto era
 * manual — o saldo ficava errado até alguém lembrar de ajustar, e ajuste sem
 * origem é o que faz o estoque deixar de ser confiável.
 *
 * Ela volta **pelo custo com que saiu** (o do movimento de saída daquele
 * item), ponderado no custo médio como qualquer entrada: devolver logo depois
 * de baixar devolve o custo médio ao que era.
 */
export async function returnConsumedItem(
  tx: Tx,
  organizationId: string,
  item: { id: string; partId: string | null; workOrderId: string; stockStatus: string; description: string },
  quantidadeMilli: number,
  userId: string | null,
  motivo: string,
): Promise<{ returned: boolean; quantityMilli: number }> {
  if (item.stockStatus !== 'CONSUMED' || !item.partId || quantidadeMilli <= 0) {
    return { returned: false, quantityMilli: 0 };
  }

  // o que ainda está fora: baixado menos o que já voltou
  const { rows } = await tx.execute<{ saiu: string; voltou: string; custo: number | null }>(sql`
    select coalesce(sum(-quantity) filter (where type = 'WORK_ORDER_OUT'), 0)::text as saiu,
           coalesce(sum(quantity) filter (where type = 'CUSTOMER_RETURN'), 0)::text as voltou,
           (array_agg(unit_cost_cents order by created_at desc) filter (where type = 'WORK_ORDER_OUT'))[1] as custo
    from inventory_movements
    where organization_id = ${organizationId} and work_order_item_id = ${item.id}
  `);
  const fora = milli(rows[0]?.saiu ?? '0') - milli(rows[0]?.voltou ?? '0');
  const volta = Math.min(quantidadeMilli, fora);
  if (volta <= 0) return { returned: false, quantityMilli: 0 };

  const [part] = await tx
    .select()
    .from(parts)
    .where(and(eq(parts.organizationId, organizationId), eq(parts.id, item.partId)))
    .limit(1)
    .for('update');
  if (!part || !part.trackStock) return { returned: false, quantityMilli: 0 };

  const custoDaSaida = rows[0]?.custo ?? part.averageCostCents ?? 0;
  const onHand = milli(part.quantityOnHand);
  const medio = weightedAverageCost({
    onHandMilli: onHand,
    averageCostCents: part.averageCostCents,
    inMilli: volta,
    unitCostCents: custoDaSaida,
  });
  const novoSaldo = onHand + volta;

  await tx.insert(inventoryMovements).values({
    organizationId,
    partId: item.partId,
    type: 'CUSTOMER_RETURN',
    quantity: milliToDecimal(volta),
    unitCostCents: custoDaSaida,
    balanceAfter: milliToDecimal(novoSaldo),
    averageCostAfterCents: medio,
    workOrderId: item.workOrderId,
    workOrderItemId: item.id,
    reason: motivo,
    createdBy: userId,
  });
  await tx
    .update(parts)
    .set({ quantityOnHand: milliToDecimal(novoSaldo), averageCostCents: medio })
    .where(eq(parts.id, item.partId));

  return { returned: true, quantityMilli: volta };
}

/**
 * Baixa do estoque na finalização da OS (docs/ARCHITECTURE.md §10): a reserva
 * vira saída `WORK_ORDER_OUT` da quantidade inteira.
 *
 * **Estoque insuficiente não trava a finalização.** O saldo fica negativo, o
 * livro-razão registra e a oficina vê o alerta. Travar aqui faria o dono
 * entregar o carro por fora do sistema — a mesma razão pela qual faltar peça
 * não impede a aprovação.
 *
 * Idempotente: item já `CONSUMED` não baixa de novo, então finalizar → reabrir
 * → finalizar não tira a peça duas vezes. Reabrir **não** estorna: a peça já
 * está no carro; devolução é caso de item removido (`CUSTOMER_RETURN`).
 */
export async function consumeApprovedItems(
  tx: Tx,
  organizationId: string,
  workOrderId: string,
  userId: string | null,
): Promise<ConsumptionSummary> {
  const summary: ConsumptionSummary = { consumed: 0, negative: [] };

  const items = await tx
    .select()
    .from(workOrderItems)
    .where(
      and(
        eq(workOrderItems.organizationId, organizationId),
        eq(workOrderItems.workOrderId, workOrderId),
        eq(workOrderItems.type, 'PART'),
        eq(workOrderItems.sourcing, 'STOCK'),
        eq(workOrderItems.approvalStatus, 'APPROVED'),
        ne(workOrderItems.stockStatus, 'CONSUMED'),
        isNotNull(workOrderItems.partId),
      ),
    );
  if (!items.length) return summary;

  // mesma ordem fixa de id da reserva: duas OS finalizando juntas não travam
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
      {
        name: part.name,
        trackStock: part.trackStock,
        onHand: milli(part.quantityOnHand),
        reserved: milli(part.quantityReserved),
        averageCostCents: part.averageCostCents,
      },
    ]),
  );

  for (const item of items) {
    const part = saldo.get(item.partId!);
    if (!part) continue;

    const usada = milli(item.quantity);
    // o CHECK do livro-razão recusa movimento de quantidade zero, e peça sem
    // controle de estoque não tem saldo para mexer
    if (part.trackStock && usada > 0) {
      part.onHand -= usada;
      part.reserved = Math.max(0, part.reserved - milli(item.reservedQuantity));

      await tx.insert(inventoryMovements).values({
        organizationId,
        partId: item.partId!,
        type: 'WORK_ORDER_OUT',
        quantity: milliToDecimal(-usada),
        // saída não recalcula custo médio: grava o vigente como histórico
        unitCostCents: part.averageCostCents,
        balanceAfter: milliToDecimal(part.onHand),
        averageCostAfterCents: part.averageCostCents,
        workOrderId,
        workOrderItemId: item.id,
        createdBy: userId,
      });
      summary.consumed += 1;
    }

    await tx
      .update(workOrderItems)
      .set({ stockStatus: 'CONSUMED', reservedQuantity: milliToDecimal(0) })
      .where(eq(workOrderItems.id, item.id));
  }

  for (const [partId, part] of saldo) {
    await tx
      .update(parts)
      .set({ quantityOnHand: milliToDecimal(part.onHand), quantityReserved: milliToDecimal(part.reserved) })
      .where(eq(parts.id, partId));
    // uma entrada por peça, não por item: duas linhas da mesma peça é um alerta só
    if (part.trackStock && part.onHand < 0) {
      summary.negative.push({ partId, name: part.name, balanceMilli: part.onHand });
    }
  }
  return summary;
}
