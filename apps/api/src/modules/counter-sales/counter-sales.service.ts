import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  can,
  counterSaleTotals,
  ErrorCode,
  lineGrossCents,
  milliToDecimal,
  parseQuantity,
  quantityMilliOf,
  weightedAverageCost,
  type CounterSale,
  type createCounterSaleSchema,
} from '@oficinaos/shared';
import type { z } from 'zod';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { COUNTER_COUNTER_SALE, nextNumber } from '../../core/counters';
import { AppError, notFound } from '../../core/errors';
import { hojeNaOficina } from '../../core/org-settings';
import {
  counterSaleItems,
  counterSales,
  customers,
  financialEntries,
  financialSettlements,
  inventoryMovements,
  parts,
  productInvoices,
  users,
} from '../../db/schema';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import * as financeRepo from '../finance/finance.repository';

type CreateInput = z.output<typeof createCounterSaleSchema>;

const milli = (value: string) => parseQuantity(value) ?? 0;

/**
 * Venda de balcão (E49). Ver `packages/shared/src/counter-sales.ts`.
 *
 * Tudo numa transação: o número da venda, a saída do estoque, a conta a
 * receber e, se pagou na hora, a baixa. Uma falha no meio desfaz tudo — não
 * existe peça que saiu sem venda, nem venda sem conta.
 */
export class CounterSalesService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, page: number, pageSize: number) {
    return withTenant(this.deps.db, auth, async (tx) => {
      const [total] = await tx
        .select({ value: count() })
        .from(counterSales)
        .where(eq(counterSales.organizationId, auth.organizationId));
      const ids = await tx
        .select({ id: counterSales.id })
        .from(counterSales)
        .where(eq(counterSales.organizationId, auth.organizationId))
        .orderBy(desc(counterSales.soldAt), desc(counterSales.number))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const data = [];
      for (const { id } of ids) data.push(await this.carregar(tx, auth.organizationId, id));
      return { data, meta: { page, pageSize, total: Number(total?.value ?? 0) } };
    });
  }

  async get(auth: AuthContext, id: string): Promise<CounterSale> {
    return withTenant(this.deps.db, auth, (tx) => this.carregar(tx, auth.organizationId, id));
  }

  async create(auth: AuthContext, input: CreateInput, client: ClientInfo): Promise<CounterSale> {
    return withTenant(this.deps.db, auth, async (tx) => {
      // clique duplo, ou rede que repete o POST: devolve a venda que já existe
      const [repetida] = await tx
        .select({ id: counterSales.id })
        .from(counterSales)
        .where(
          and(eq(counterSales.organizationId, auth.organizationId), eq(counterSales.clientRequestId, input.clientRequestId)),
        )
        .limit(1);
      if (repetida) return this.carregar(tx, auth.organizationId, repetida.id);

      if (input.discountCents > 0 && !can(auth.role, 'work_orders:discount')) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Sem permissão para dar desconto', 'Seu papel não permite dar desconto.');
      }
      if (input.customerId) {
        const [cliente] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.organizationId, auth.organizationId),
              eq(customers.id, input.customerId),
              isNull(customers.deletedAt),
            ),
          )
          .limit(1);
        if (!cliente) throw notFound('Cliente não encontrado.');
      }

      // peças travadas em ordem fixa de id (a mesma da OS): duas vendas, ou uma
      // venda e uma finalização de OS, mexendo na mesma peça não travam
      const partIds = [...new Set(input.items.flatMap((item) => (item.partId ? [item.partId] : [])))].sort();
      const travadas = partIds.length
        ? await tx
            .select()
            .from(parts)
            .where(
              and(eq(parts.organizationId, auth.organizationId), inArray(parts.id, partIds), isNull(parts.deletedAt)),
            )
            .orderBy(asc(parts.id))
            .for('update')
        : [];
      const pecas = new Map(travadas.map((part) => [part.id, { ...part, onHand: milli(part.quantityOnHand) }]));
      const faltando = partIds.filter((partId) => !pecas.has(partId));
      if (faltando.length) throw notFound('Uma das peças não existe mais no catálogo.');

      const linhas = input.items.map((item) => ({
        ...item,
        quantityMilli: quantityMilliOf(item.quantity),
        description: item.description || (item.partId ? pecas.get(item.partId)!.name : ''),
      }));
      const totais = counterSaleTotals(linhas, input.discountCents);

      const number = await nextNumber(tx, auth.organizationId, COUNTER_COUNTER_SALE);
      const [venda] = await tx
        .insert(counterSales)
        .values({
          organizationId: auth.organizationId,
          number,
          customerId: input.customerId,
          subtotalCents: totais.subtotalCents,
          discountCents: totais.discountCents,
          totalCents: totais.totalCents,
          notes: input.notes || null,
          clientRequestId: input.clientRequestId,
          soldBy: auth.userId,
        })
        .returning();

      for (const [position, linha] of linhas.entries()) {
        const peca = linha.partId ? pecas.get(linha.partId)! : null;
        await tx.insert(counterSaleItems).values({
          organizationId: auth.organizationId,
          saleId: venda!.id,
          partId: linha.partId,
          description: linha.description,
          quantity: milliToDecimal(linha.quantityMilli),
          unitPriceCents: linha.unitPriceCents,
          unitCostCents: peca ? (peca.averageCostCents ?? peca.lastCostCents) : null,
          totalCents: lineGrossCents(linha.quantityMilli, linha.unitPriceCents),
          position,
        });

        // peça sem controle de estoque não tem saldo para mexer
        if (peca?.trackStock) {
          peca.onHand -= linha.quantityMilli;
          await tx.insert(inventoryMovements).values({
            organizationId: auth.organizationId,
            partId: peca.id,
            type: 'COUNTER_SALE_OUT',
            quantity: milliToDecimal(-linha.quantityMilli),
            // saída não recalcula o custo médio: grava o vigente como histórico
            unitCostCents: peca.averageCostCents,
            balanceAfter: milliToDecimal(peca.onHand),
            averageCostAfterCents: peca.averageCostCents,
            counterSaleId: venda!.id,
            createdBy: auth.userId,
          });
        }
      }
      for (const peca of pecas.values()) {
        if (peca.trackStock) {
          await tx.update(parts).set({ quantityOnHand: milliToDecimal(peca.onHand) }).where(eq(parts.id, peca.id));
        }
      }

      // venda de graça (desconto de 100%) não tem conta: o CHECK do financeiro
      // recusa lançamento de valor zero, e não há o que receber
      if (totais.totalCents > 0) {
        const pagoNaHora = input.payment.kind === 'PAID';
        const hoje = await hojeNaOficina(tx, auth.organizationId);
        const categoria = await financeRepo.findCategoryByKey(tx, auth.organizationId, 'SERVICES');
        const [conta] = await financeRepo.insertEntries(tx, [
          {
            organizationId: auth.organizationId,
            direction: 'RECEIVABLE',
            origin: 'COUNTER_SALE',
            categoryId: categoria?.id ?? null,
            description: `Venda de balcão nº ${number}`,
            amountCents: totais.totalCents,
            dueDate: input.payment.kind === 'LATER' ? input.payment.dueDate : hoje,
            customerId: input.customerId,
            counterSaleId: venda!.id,
            createdBy: auth.userId,
          },
        ]);
        if (pagoNaHora && input.payment.kind === 'PAID') {
          await financeRepo.insertSettlement(tx, {
            organizationId: auth.organizationId,
            entryId: conta!.id,
            clientRequestId: input.clientRequestId,
            amountCents: totais.totalCents,
            method: input.payment.method,
            createdBy: auth.userId,
          });
          await financeRepo.updateEntry(tx, conta!.id, {
            paidCents: totais.totalCents,
            status: 'PAID',
            settledAt: new Date(),
          });
        }
      }

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'counter_sale.created',
        entityType: 'counter_sale',
        entityId: venda!.id,
        metadata: {
          number,
          totalCents: totais.totalCents,
          items: linhas.length,
          payment: input.payment.kind === 'PAID' ? input.payment.method : input.payment.kind,
        },
        ...client,
      });

      const negativas = [...pecas.values()]
        .filter((peca) => peca.trackStock && peca.onHand < 0)
        .map((peca) => ({ partId: peca.id, name: peca.name }));
      return { ...(await this.carregar(tx, auth.organizationId, venda!.id)), negativeStock: negativas };
    });
  }

  /**
   * Cancelar desfaz as três coisas da venda: a peça volta ao estoque pelo
   * custo com que saiu, a baixa (se houve) vira cancelada com o mesmo motivo,
   * e a conta a receber é cancelada. A venda fica, marcada, com quem e por quê.
   */
  async cancel(auth: AuthContext, id: string, reason: string, client: ClientInfo): Promise<CounterSale> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const [venda] = await tx
        .select()
        .from(counterSales)
        .where(and(eq(counterSales.organizationId, auth.organizationId), eq(counterSales.id, id)))
        .limit(1)
        .for('update');
      if (!venda) throw notFound('Venda não encontrada.');
      if (venda.status === 'CANCELED') {
        throw new AppError(409, ErrorCode.CONFLICT, 'Venda já cancelada', 'Esta venda já estava cancelada.');
      }
      const [comNota] = await tx
        .select({ id: productInvoices.id })
        .from(productInvoices)
        .where(
          and(
            eq(productInvoices.organizationId, auth.organizationId),
            eq(productInvoices.counterSaleId, id),
            inArray(productInvoices.status, ['QUEUED', 'AUTHORIZED']),
          ),
        )
        .limit(1);
      if (comNota) {
        // a mercadoria já saiu com nota: desfazer a venda sem cancelar a nota deixaria a SEFAZ e o caixa discordando
        throw new AppError(409, ErrorCode.CONFLICT, 'Venda com nota', 'Cancele primeiro a nota das peças desta venda.');
      }
      const motivo = reason.trim();
      const agora = new Date();

      const itens = await tx
        .select()
        .from(counterSaleItems)
        .where(and(eq(counterSaleItems.organizationId, auth.organizationId), eq(counterSaleItems.saleId, id)));
      const partIds = [...new Set(itens.flatMap((item) => (item.partId ? [item.partId] : [])))].sort();
      const travadas = partIds.length
        ? await tx
            .select()
            .from(parts)
            .where(and(eq(parts.organizationId, auth.organizationId), inArray(parts.id, partIds)))
            .orderBy(asc(parts.id))
            .for('update')
        : [];
      const pecas = new Map(
        travadas.map((part) => [part.id, { ...part, onHand: milli(part.quantityOnHand), medio: part.averageCostCents }]),
      );

      // só volta o que de fato saiu: a peça que não controlava estoque na
      // venda não tem movimento de saída, e não ganha entrada agora
      const saidas = await tx
        .select({ partId: inventoryMovements.partId, quantity: inventoryMovements.quantity, custo: inventoryMovements.unitCostCents })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.organizationId, auth.organizationId),
            eq(inventoryMovements.counterSaleId, id),
            eq(inventoryMovements.type, 'COUNTER_SALE_OUT'),
          ),
        );
      for (const saida of saidas) {
        const peca = pecas.get(saida.partId);
        if (!peca) continue;
        const volta = -milli(saida.quantity);
        const custo = saida.custo ?? peca.medio ?? 0;
        peca.medio = weightedAverageCost({ onHandMilli: peca.onHand, averageCostCents: peca.medio, inMilli: volta, unitCostCents: custo });
        peca.onHand += volta;
        await tx.insert(inventoryMovements).values({
          organizationId: auth.organizationId,
          partId: peca.id,
          type: 'COUNTER_SALE_RETURN',
          quantity: milliToDecimal(volta),
          unitCostCents: custo,
          balanceAfter: milliToDecimal(peca.onHand),
          averageCostAfterCents: peca.medio,
          counterSaleId: id,
          reason: motivo,
          createdBy: auth.userId,
        });
      }
      for (const peca of pecas.values()) {
        await tx
          .update(parts)
          .set({ quantityOnHand: milliToDecimal(peca.onHand), averageCostCents: peca.medio })
          .where(eq(parts.id, peca.id));
      }

      const contas = await tx
        .select()
        .from(financialEntries)
        .where(and(eq(financialEntries.organizationId, auth.organizationId), eq(financialEntries.counterSaleId, id)))
        .for('update');
      for (const conta of contas) {
        await tx
          .update(financialSettlements)
          .set({ status: 'CANCELED', canceledAt: agora, canceledBy: auth.userId, cancelReason: motivo })
          .where(
            and(
              eq(financialSettlements.organizationId, auth.organizationId),
              eq(financialSettlements.entryId, conta.id),
              eq(financialSettlements.status, 'CONFIRMED'),
            ),
          );
        if (conta.status !== 'CANCELED') {
          await financeRepo.updateEntry(tx, conta.id, {
            status: 'CANCELED',
            paidCents: 0,
            settledAt: null,
            canceledAt: agora,
            canceledBy: auth.userId,
            cancelReason: motivo,
          });
        }
      }

      await tx
        .update(counterSales)
        .set({ status: 'CANCELED', canceledAt: agora, canceledBy: auth.userId, cancelReason: motivo, updatedAt: agora })
        .where(eq(counterSales.id, id));

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'counter_sale.canceled',
        entityType: 'counter_sale',
        entityId: id,
        metadata: { number: venda.number, totalCents: venda.totalCents, reason: motivo },
        ...client,
      });
      return this.carregar(tx, auth.organizationId, id);
    });
  }

  private async carregar(tx: Tx, organizationId: string, id: string): Promise<CounterSale> {
    const [linha] = await tx
      .select({ venda: counterSales, customerName: customers.name, soldByName: users.name })
      .from(counterSales)
      .leftJoin(
        customers,
        and(eq(customers.organizationId, counterSales.organizationId), eq(customers.id, counterSales.customerId)),
      )
      .leftJoin(users, eq(users.id, counterSales.soldBy))
      .where(and(eq(counterSales.organizationId, organizationId), eq(counterSales.id, id)))
      .limit(1);
    if (!linha) throw notFound('Venda não encontrada.');
    const itens = await tx
      .select()
      .from(counterSaleItems)
      .where(and(eq(counterSaleItems.organizationId, organizationId), eq(counterSaleItems.saleId, id)))
      .orderBy(asc(counterSaleItems.position));
    const [conta] = await tx
      .select({ id: financialEntries.id, paidCents: financialEntries.paidCents })
      .from(financialEntries)
      .where(and(eq(financialEntries.organizationId, organizationId), eq(financialEntries.counterSaleId, id)))
      .orderBy(sql`created_at`)
      .limit(1);
    const { venda } = linha;
    return {
      id: venda.id,
      number: venda.number,
      status: venda.status,
      customerId: venda.customerId,
      customerName: linha.customerName,
      subtotalCents: venda.subtotalCents,
      discountCents: venda.discountCents,
      totalCents: venda.totalCents,
      paidCents: conta?.paidCents ?? 0,
      financialEntryId: conta?.id ?? null,
      notes: venda.notes,
      soldAt: venda.soldAt.toISOString(),
      soldByName: linha.soldByName,
      canceledAt: venda.canceledAt?.toISOString() ?? null,
      cancelReason: venda.cancelReason,
      items: itens.map((item) => ({
        id: item.id,
        partId: item.partId,
        description: item.description,
        quantity: milli(item.quantity) / 1000,
        unitPriceCents: item.unitPriceCents,
        totalCents: item.totalCents,
      })),
      negativeStock: [],
    };
  }
}
