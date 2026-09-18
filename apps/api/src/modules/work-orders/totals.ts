import {
  computeApprovedTotals,
  computeTotals,
  lineTotalCents,
  parseQuantity,
  type PricingLine,
} from '@oficinaos/shared';
import type { workOrders } from '../../db/schema';
import type { Tx } from '../../db/tenant';
import { syncWorkOrderEntries } from '../finance/finance.sync';
import * as repo from './work-orders.repository';

type OrderPatch = Partial<typeof workOrders.$inferInsert>;

/** numeric do banco ("4.500") → milésimos. */
const milli = (value: string) => parseQuantity(value) ?? 0;

/**
 * As linhas da OS no formato do `pricing.ts`. Mora aqui, e não dentro de um
 * service, porque DUAS entradas mexem nos mesmos números: a OS (itens,
 * desconto) e o orçamento (aprovar/recusar item). Duplicar a conta seria
 * garantir que as duas divirjam um dia.
 */
export async function pricingLinesOf(tx: Tx, order: repo.WorkOrderRow): Promise<PricingLine[]> {
  const rows = await repo.listItems(tx, order.organizationId, order.id);
  return rows.map(({ item }) => ({
    type: item.type,
    quantityMilli: milli(item.quantity),
    unitPriceCents: item.unitPriceCents,
    discountCents: item.discountCents,
    isOptional: item.isOptional,
    approved: item.approvalStatus === 'APPROVED',
  }));
}

/**
 * Aplica a mudança, recalcula os totais pelo `pricing.ts` e sobe a versão —
 * tudo numa gravação só. A API nunca confia em total vindo do front.
 *
 * Toda gravação da OS passa por aqui, então é aqui que a **conta a receber**
 * (E13) é mantida colada na OS: aprovar um item, dar desconto ou registrar
 * pagamento já deixa o financeiro certo, sem ninguém precisar lembrar.
 */
export async function applyWorkOrderChange(
  tx: Tx,
  order: repo.WorkOrderRow,
  patch: OrderPatch = {},
): Promise<repo.WorkOrderRow> {
  const merged = { ...order, ...patch };
  const rows = await repo.listItems(tx, order.organizationId, order.id);
  const lines: PricingLine[] = rows.map(({ item }) => ({
    type: item.type,
    quantityMilli: milli(item.quantity),
    unitPriceCents: item.unitPriceCents,
    discountCents: item.discountCents,
    isOptional: item.isOptional,
    approved: item.approvalStatus === 'APPROVED',
  }));
  const options = {
    discountMode: merged.discountMode,
    discountValue: merged.discountValue,
    surchargeCents: merged.surchargeCents,
  };
  const totals = computeTotals(lines, options);
  const approved = computeApprovedTotals(lines, options);

  // o total de cada linha é cache também: a OS impressa bate com a soma das linhas
  for (const [index, { item }] of rows.entries()) {
    const total = lineTotalCents(lines[index]!);
    if (total !== item.totalCents) await repo.updateItem(tx, item.id, { totalCents: total });
  }

  const updated = await repo.updateWorkOrder(tx, order.id, {
    ...patch,
    partsSubtotalCents: totals.partsSubtotalCents,
    servicesSubtotalCents: totals.servicesSubtotalCents,
    discountCents: totals.discountCents,
    totalCents: totals.totalCents,
    approvedTotalCents: approved.totalCents,
    version: order.version + 1,
  });
  await syncWorkOrderEntries(tx, order.organizationId, updated);
  return updated;
}
