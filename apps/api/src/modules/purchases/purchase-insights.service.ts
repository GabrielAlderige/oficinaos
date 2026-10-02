import {
  can,
  formatQuantity,
  milliToNumber,
  parseQuantity,
  suggestedRestockMilli,
  type PartPriceHistory,
  type PurchaseSuggestions,
  type SupplierHistory,
} from '@oficinaos/shared';
import type { AuthContext, ServiceDeps } from '../../core/auth-context';
import { notFound } from '../../core/errors';
import { withTenant } from '../../db/tenant';
import * as repo from './purchases.repository';

const milli = (valor: string) => parseQuantity(valor) ?? 0;

/**
 * O que comprar e o histórico de quem vende e de quanto custou (E12).
 *
 * Só leitura: saiu do service de compras, que passava de 1.300 linhas e
 * misturava estas consultas com o ciclo do pedido (criar, pedir, receber,
 * devolver).
 */
export class PurchaseInsightsService {
  constructor(private readonly deps: ServiceDeps) {}

  /**
   * O que comprar: peça abaixo do mínimo (descontando o que já vem) e peça que
   * uma OS em andamento espera sem pedido. Agrupado pelo fornecedor preferido;
   * quem não tem preferido cai no grupo "sem fornecedor".
   */
  async suggestions(auth: AuthContext): Promise<PurchaseSuggestions> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      type Grupo = PurchaseSuggestions['groups'][number];
      const grupos = new Map<string, Grupo>();
      const noGrupo = (supplier: { id: string | null; name: string | null } | null) => {
        const chave = supplier?.id ?? '';
        const grupo = grupos.get(chave) ?? { supplier: supplier?.id ? { id: supplier.id, name: supplier.name! } : null, items: [] };
        grupos.set(chave, grupo);
        return grupo;
      };

      for (const { item, workOrderNumber, part, supplier } of await repo.listWorkOrderCandidates(tx, org)) {
        const comprar = item.sourcing === 'TO_ORDER';
        const quantidade = comprar ? milli(item.quantity) : milli(item.quantity) - milli(item.reservedQuantity);
        if (quantidade <= 0) continue;
        noGrupo(supplier).items.push({
          kind: 'WORK_ORDER',
          partId: part.id,
          partName: part.name,
          partCode: part.manufacturerCode,
          unit: part.unit,
          quantity: milliToNumber(quantidade),
          unitCostCents: part.lastCostCents ?? part.averageCostCents,
          workOrderItemId: item.id,
          workOrderNumber,
          reason: comprar
            ? `OS ${workOrderNumber}: marcada "Comprar"${item.approvalStatus === 'APPROVED' ? '' : ', orçamento ainda sem aprovação'}`
            : `OS ${workOrderNumber}: faltou no estoque`,
        });
      }

      for (const { part, supplier, incoming } of await repo.listRestockCandidates(tx, org)) {
        const onHand = milli(part.quantityOnHand);
        const reserved = milli(part.quantityReserved);
        const quantidade = suggestedRestockMilli({
          minMilli: milli(part.minQuantity),
          onHandMilli: onHand,
          reservedMilli: reserved,
          incomingMilli: parseQuantity(incoming) ?? 0,
        });
        if (quantidade === null) continue;
        const unidade = part.unit.toLowerCase();
        noGrupo(supplier).items.push({
          kind: 'RESTOCK',
          partId: part.id,
          partName: part.name,
          partCode: part.manufacturerCode,
          unit: part.unit,
          quantity: milliToNumber(quantidade),
          unitCostCents: part.lastCostCents ?? part.averageCostCents,
          workOrderItemId: null,
          workOrderNumber: null,
          reason: `abaixo do mínimo: disponível ${formatQuantity(onHand - reserved, unidade)} de ${formatQuantity(milli(part.minQuantity), unidade)}${
            milli(incoming) > 0 ? `, ${formatQuantity(milli(incoming), unidade)} já pedida(s)` : ''
          }`,
        });
      }

      // fornecedores por nome; "sem fornecedor preferido" por último
      return {
        groups: [...grupos.values()].sort((a, b) =>
          !a.supplier ? 1 : !b.supplier ? -1 : a.supplier.name.localeCompare(b.supplier.name, 'pt-BR'),
        ),
      };
    });
  }

  /** Cotações com o fornecedor e, para quem vê compras, os pedidos a ele. */
  async supplierHistory(auth: AuthContext, supplierId: string): Promise<SupplierHistory> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      if (!(await repo.findSupplier(tx, org, supplierId))) throw notFound('Fornecedor não encontrado.');
      const cotacoes = await repo.listSupplierQuotesFor(tx, org, supplierId, 20);
      // compra é custo: o atendente vê o fornecedor e as cotações, não os pedidos
      const compras = can(auth.role, 'purchases:read')
        ? (await repo.listOrders(tx, org, { status: 'all', supplierId, page: 1, pageSize: 20 })).rows
        : null;
      return {
        quotes: cotacoes.map((c) => ({
          id: c.id,
          number: c.number,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
          workOrderNumber: c.workOrderNumber,
          answered: c.answered,
        })),
        purchases:
          compras?.map((row) => ({
            id: row.order.id,
            number: row.order.number,
            status: row.order.status,
            createdAt: row.order.createdAt.toISOString(),
            totalCents: Number(row.itemsTotalCents) + row.order.shippingCents,
            itemCount: row.itemCount,
          })) ?? null,
      };
    });
  }

  /** Quanto cada fornecedor cobrou pela peça, nas cotações e nas compras. */
  async partPriceHistory(auth: AuthContext, partId: string): Promise<PartPriceHistory> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      if (!(await repo.partExists(tx, org, partId))) throw notFound('Peça não encontrada.');
      const linhas = await repo.listPriceHistory(tx, org, partId, 50);
      return {
        data: linhas.map(({ history, supplier, purchaseOrderNumber, quoteNumber, quoteWorkOrderNumber }) => ({
          id: history.id,
          capturedAt: history.capturedAt.toISOString(),
          supplier: supplier?.id && supplier.name ? { id: supplier.id, name: supplier.name } : null,
          priceCents: history.priceCents,
          source: history.source,
          purchaseOrder: history.purchaseOrderId && purchaseOrderNumber !== null ? { id: history.purchaseOrderId, number: purchaseOrderNumber } : null,
          supplierQuote:
            history.supplierQuoteRequestId && quoteNumber !== null
              ? { id: history.supplierQuoteRequestId, number: quoteNumber, workOrderNumber: quoteWorkOrderNumber }
              : null,
        })),
      };
    });
  }
}
