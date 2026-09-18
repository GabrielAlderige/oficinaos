import {
  allocateFreight,
  averageCostAfterReturn,
  can,
  canPurchaseAction,
  ErrorCode,
  formatBRL,
  formatQuantity,
  isValidOffer,
  landedUnitCostCents,
  latestVersions,
  lineValueCents,
  milliToDecimal,
  milliToNumber,
  parseQuantity,
  purchaseOrderTotals,
  remainingMilli,
  returnableMilli,
  statusAfterReceipt,
  suggestedRestockMilli,
  weightedAverageCost,
  whatsappLink,
  whatsappPurchaseOrderMessage,
  type CancelPurchaseOrderInput,
  type ClosePurchaseOrderInput,
  type CreatePurchaseOrderInput,
  type OrderedPurchaseOrder,
  type OrderPurchaseOrderInput,
  type Page,
  type PartPriceHistory,
  type PurchaseAction,
  type PurchaseOrder,
  type PurchaseOrderLineInput,
  type PurchaseOrderListItem,
  type PurchaseOrderListQuery,
  type PurchaseOrdersFromQuoteResult,
  type PurchaseSuggestions,
  type ReceivePurchaseOrderInput,
  type ReturnPurchaseOrderInput,
  type SupplierHistory,
  type UpdatePurchaseOrderInput,
  type WorkOrderPurchaseLine,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import { createPurchasePayable, reducePurchasePayable } from '../finance/finance.sync';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { nextNumber } from '../../core/counters';
import { AppError, notFound, validationFailed, type FieldError } from '../../core/errors';
import { blankToNull, isoOrNull } from '../../core/normalize';
import { withTenant, type Tx } from '../../db/tenant';
import * as quoteRepo from '../supplier-quotes/supplier-quotes.repository';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import * as repo from './purchases.repository';

export const COUNTER_PURCHASE_ORDER = 'purchase_order';

const milli = (valor: string) => parseQuantity(valor) ?? 0;

const LABEL_ACAO: Record<PurchaseAction, string> = {
  edit: 'editar',
  order: 'marcar como pedido',
  receive: 'receber',
  close: 'encerrar o que falta',
  cancel: 'cancelar',
  return: 'devolver ao fornecedor',
};

const SITUACAO: Record<string, string> = {
  DRAFT: 'em rascunho',
  ORDERED: 'já pedido',
  PARTIAL: 'com parte recebida',
  RECEIVED: 'recebido',
  CANCELED: 'cancelado',
};

/** A ação não cabe na situação atual do pedido: 422 com a explicação em português. */
export function assertPurchaseAction(status: string, action: PurchaseAction) {
  if (!canPurchaseAction(status as never, action)) {
    throw new AppError(
      422,
      ErrorCode.PURCHASE_ORDER_STATE,
      'Ação indisponível para este pedido',
      `Não dá para ${LABEL_ACAO[action]} um pedido ${SITUACAO[status] ?? status}.`,
    );
  }
}

const dataCurta = (iso: string) => {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
};

/**
 * Pedidos de compra (MVP 2, E12) — criar, editar o rascunho, marcar como pedido,
 * cancelar, encerrar o que falta e gerar a partir da cotação. Recebimento e
 * devolução mexem em estoque e ficam em `receipts.service.ts`.
 *
 * O que este serviço garante, e os testes provam:
 * - nome e código da linha saem do cadastro da peça, nunca da tela;
 * - a peça de uma OS não entra em dois pedidos vivos, e a escolha da cotação
 *   não vira dois pedidos;
 * - fora do rascunho as linhas não mudam; cancelar só sem nada recebido.
 */
export class PurchasesService {
  constructor(private readonly deps: ServiceDeps) {}

  // ================================ ler ======================================

  async list(auth: AuthContext, query: PurchaseOrderListQuery): Promise<Page<PurchaseOrderListItem>> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const { rows, total } = await repo.listOrders(tx, auth.organizationId, query);
      return {
        data: rows.map((row) => ({
          id: row.order.id,
          number: row.order.number,
          status: row.order.status,
          supplierId: row.order.supplierId,
          supplierName: row.supplierName,
          itemCount: row.itemCount,
          totalCents: Number(row.itemsTotalCents) + row.order.shippingCents,
          expectedOn: row.order.expectedOn,
          createdAt: row.order.createdAt.toISOString(),
          orderedAt: isoOrNull(row.order.orderedAt),
          workOrderNumbers: row.workOrderNumbers ?? [],
        })),
        meta: { page: query.page, pageSize: query.pageSize, total },
      };
    });
  }

  async get(auth: AuthContext, id: string): Promise<PurchaseOrder> {
    return withTenant(this.deps.db, auth, (tx) => this.carregar(tx, auth.organizationId, id));
  }

  async listForWorkOrder(auth: AuthContext, workOrderId: string): Promise<{ data: WorkOrderPurchaseLine[] }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const linhas = await repo.listLinesForWorkOrder(tx, auth.organizationId, workOrderId);
      return {
        data: linhas.map(({ line, order, supplierName }) => ({
          purchaseOrderId: order.id,
          purchaseOrderNumber: order.number,
          status: order.status,
          supplierName,
          workOrderItemId: line.workOrderItemId!,
          description: line.description,
          quantity: milliToNumber(milli(line.quantity)),
          receivedQuantity: milliToNumber(milli(line.receivedQuantity)),
          expectedOn: order.expectedOn,
        })),
      };
    });
  }

  // =============================== criar =====================================

  async create(auth: AuthContext, input: CreatePurchaseOrderInput, client: ClientInfo): Promise<PurchaseOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      await this.fornecedorAtivo(tx, org, input.supplierId, 'body.supplierId');
      const linhas = await this.montarLinhas(tx, org, input.items);
      const number = await nextNumber(tx, org, COUNTER_PURCHASE_ORDER);
      const pedido = await repo.insertOrder(tx, {
        organizationId: org,
        number,
        supplierId: input.supplierId,
        expectedOn: input.expectedOn,
        shippingCents: input.shippingCents,
        notes: blankToNull(input.notes) ?? null,
        createdBy: auth.userId,
      });
      await repo.replaceLines(tx, org, pedido.id, linhas.map((linha) => ({ ...linha, purchaseOrderId: pedido.id })));
      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'purchase_order.created',
        entityType: 'purchase_order',
        entityId: pedido.id,
        metadata: { number, supplierId: input.supplierId, items: linhas.length },
        ...client,
      });
      return this.carregar(tx, org, pedido.id);
    });
  }

  /** Só o rascunho muda. As linhas, quando vêm, substituem as anteriores. */
  async update(auth: AuthContext, id: string, input: UpdatePurchaseOrderInput, client: ClientInfo): Promise<PurchaseOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const pedido = await repo.lockOrder(tx, org, id);
      if (!pedido) throw notFound('Pedido de compra não encontrado.');
      assertPurchaseAction(pedido.status, 'edit');
      if (input.version !== pedido.version) throw versaoMudou();

      if (input.supplierId && input.supplierId !== pedido.supplierId) {
        await this.fornecedorAtivo(tx, org, input.supplierId, 'body.supplierId');
      }
      if (input.items) {
        // a linha que veio da cotação continua ligada à escolha: sem isso, editar
        // o rascunho liberaria a mesma escolha para virar um segundo pedido
        const chave = (partId: string, workOrderItemId: string | null) => `${partId}|${workOrderItemId ?? ''}`;
        const escolhaDe = new Map(
          (await repo.listLines(tx, org, pedido.id))
            .filter(({ line }) => line.supplierQuoteAwardId)
            .map(({ line }) => [chave(line.partId, line.workOrderItemId), line.supplierQuoteAwardId]),
        );
        const linhas = await this.montarLinhas(tx, org, input.items, pedido.id);
        await repo.replaceLines(
          tx,
          org,
          pedido.id,
          linhas.map((linha) => {
            const awardId = escolhaDe.get(chave(linha.partId, linha.workOrderItemId)) ?? null;
            escolhaDe.delete(chave(linha.partId, linha.workOrderItemId));
            return { ...linha, purchaseOrderId: pedido.id, supplierQuoteAwardId: awardId };
          }),
        );
      }
      await repo.updateOrder(tx, pedido.id, {
        supplierId: input.supplierId,
        expectedOn: input.expectedOn,
        shippingCents: input.shippingCents,
        notes: input.notes === undefined ? undefined : (blankToNull(input.notes) ?? null),
        version: pedido.version + 1,
      });
      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'purchase_order.updated',
        entityType: 'purchase_order',
        entityId: pedido.id,
        metadata: { number: pedido.number, items: input.items?.length ?? null },
        ...client,
      });
      return this.carregar(tx, org, pedido.id);
    });
  }

  // ============================ pedir ao fornecedor ==========================

  /**
   * O pedido foi feito: as linhas congelam e sai a mensagem pronta para o
   * WhatsApp do fornecedor. Quem manda é a pessoa (wa.me), como no orçamento.
   */
  async order(auth: AuthContext, id: string, input: OrderPurchaseOrderInput, client: ClientInfo): Promise<OrderedPurchaseOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const pedido = await repo.lockOrder(tx, org, id);
      if (!pedido) throw notFound('Pedido de compra não encontrado.');
      assertPurchaseAction(pedido.status, 'order');
      if (input.version !== pedido.version) throw versaoMudou();
      const fornecedor = await repo.findSupplier(tx, org, pedido.supplierId);
      if (!fornecedor || fornecedor.deletedAt) {
        throw new AppError(422, ErrorCode.PURCHASE_ORDER_STATE, 'Fornecedor fora da lista', 'Este fornecedor foi tirado da lista. Troque o fornecedor do rascunho.');
      }

      const linhas = await repo.listLines(tx, org, pedido.id);
      // a OS pode ter mudado desde o rascunho: confere de novo antes de congelar
      await this.conferirItensDaOs(
        tx,
        org,
        linhas.map(({ line }, indice) => ({ indice, partId: line.partId, workOrderItemId: line.workOrderItemId })),
        pedido.id,
      );

      const expectedOn = input.expectedOn === undefined ? pedido.expectedOn : input.expectedOn;
      await repo.updateOrder(tx, pedido.id, {
        status: 'ORDERED',
        orderedAt: new Date(),
        orderedBy: auth.userId,
        expectedOn,
        version: pedido.version + 1,
      });

      // a timeline de cada OS atendida conta que a peça foi pedida
      const porOs = new Map<string, string[]>();
      for (const { line, workOrder, unit } of linhas) {
        if (!workOrder?.id) continue;
        const lista = porOs.get(workOrder.id) ?? [];
        lista.push(`${line.description} (${formatQuantity(milli(line.quantity), unit.toLowerCase())})`);
        porOs.set(workOrder.id, lista);
      }
      for (const [workOrderId, pecas] of porOs) {
        await workOrderRepo.insertEvent(tx, {
          organizationId: org,
          workOrderId,
          type: 'PURCHASE_ORDERED',
          data: {
            text: `Pedido de compra nº ${pedido.number} feito a ${fornecedor.name}: ${pecas.join(', ')}.${expectedOn ? ` Previsão: ${dataCurta(expectedOn)}.` : ''}`,
            purchaseOrderId: pedido.id,
            number: pedido.number,
          },
          actorUserId: auth.userId,
        });
      }

      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'purchase_order.ordered',
        entityType: 'purchase_order',
        entityId: pedido.id,
        metadata: { number: pedido.number, supplierId: fornecedor.id, expectedOn },
        ...client,
      });

      const oficina = await workOrderRepo.findOrganization(tx, org);
      const message = whatsappPurchaseOrderMessage({
        shopName: oficina?.name ?? 'Oficina',
        contactName: fornecedor.contactName,
        number: pedido.number,
        lines: linhas.map(({ line, unit }) => ({
          description: line.description,
          partCode: line.partCode,
          quantity: formatQuantity(milli(line.quantity), unit.toLowerCase()),
          unitCost: formatBRL(line.unitCostCents),
        })),
        shipping: pedido.shippingCents > 0 ? formatBRL(pedido.shippingCents) : null,
        expectedOn: expectedOn ? dataCurta(expectedOn) : null,
      });
      return {
        order: await this.carregar(tx, org, pedido.id),
        message,
        whatsappUrl: fornecedor.whatsapp ? whatsappLink(fornecedor.whatsapp, message) : null,
      };
    });
  }

  // ========================= cancelar e encerrar =============================

  async cancel(auth: AuthContext, id: string, input: CancelPurchaseOrderInput, client: ClientInfo): Promise<PurchaseOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const pedido = await repo.lockOrder(tx, org, id);
      if (!pedido) throw notFound('Pedido de compra não encontrado.');
      assertPurchaseAction(pedido.status, 'cancel');
      const motivo = input.reason.trim();
      await repo.updateOrder(tx, pedido.id, {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: auth.userId,
        cancelReason: motivo,
        version: pedido.version + 1,
      });
      // se já tinha ido ao fornecedor, a OS precisa saber que a peça não vem mais
      if (pedido.status === 'ORDERED') {
        await this.avisarOs(tx, org, pedido.id, auth.userId, `Pedido de compra nº ${pedido.number} cancelado: ${motivo}. A peça precisa ser pedida de novo.`);
      }
      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'purchase_order.canceled',
        entityType: 'purchase_order',
        entityId: pedido.id,
        metadata: { number: pedido.number, from: pedido.status, reason: motivo },
        ...client,
      });
      return this.carregar(tx, org, pedido.id);
    });
  }

  /** "O resto não vem": o pedido fecha com o que chegou, e a peça que faltou volta a precisar de compra. */
  async close(auth: AuthContext, id: string, input: ClosePurchaseOrderInput, client: ClientInfo): Promise<PurchaseOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const pedido = await repo.lockOrder(tx, org, id);
      if (!pedido) throw notFound('Pedido de compra não encontrado.');
      assertPurchaseAction(pedido.status, 'close');
      const motivo = input.reason.trim();
      const agora = new Date();
      await repo.updateOrder(tx, pedido.id, {
        status: 'RECEIVED',
        receivedAt: agora,
        closedShortAt: agora,
        closeReason: motivo,
        version: pedido.version + 1,
      });
      await this.avisarOs(tx, org, pedido.id, auth.userId, `Pedido de compra nº ${pedido.number} encerrado sem chegar tudo: ${motivo}.`, true);
      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'purchase_order.closed_short',
        entityType: 'purchase_order',
        entityId: pedido.id,
        metadata: { number: pedido.number, reason: motivo },
        ...client,
      });
      return this.carregar(tx, org, pedido.id);
    });
  }

  // ========================= a partir da cotação =============================

  /**
   * Um rascunho por fornecedor com as ofertas escolhidas na cotação (E11). Preço
   * e frete são os que o fornecedor respondeu; a quantidade é a pedida na
   * cotação. O que não dá para comprar fica de fora, com o motivo.
   */
  async fromQuote(auth: AuthContext, supplierQuoteRequestId: string, client: ClientInfo): Promise<PurchaseOrdersFromQuoteResult> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const cotacao = await quoteRepo.lockRequest(tx, org, supplierQuoteRequestId);
      if (!cotacao) throw notFound('Cotação não encontrada.');
      if (cotacao.status === 'CANCELED') {
        throw new AppError(422, ErrorCode.PURCHASE_ORDER_STATE, 'Cotação cancelada', 'Não dá para gerar pedido de uma cotação cancelada.');
      }
      const escolhas = await quoteRepo.listAwards(tx, org, cotacao.id);
      if (!escolhas.length) {
        throw new AppError(422, ErrorCode.PURCHASE_ORDER_STATE, 'Nada escolhido', 'Escolha as ofertas da cotação antes de gerar os pedidos.');
      }

      const itens = new Map((await quoteRepo.listRequestItems(tx, org, cotacao.id)).map((item) => [item.id, item]));
      const respostas = await quoteRepo.listResponses(tx, org, cotacao.id);
      const ultimas = latestVersions(respostas.map((r) => ({ ...r, inviteId: r.response.inviteId, version: r.response.version })));
      const ofertas = new Map(
        ultimas.flatMap((resposta) =>
          resposta.items.map((linha) => [linha.id, { linha, supplierId: resposta.supplierId, shippingCents: resposta.response.shippingCents }] as const),
        ),
      );
      const jaPedidas = new Map(
        (await repo.listActiveLines(tx, org, { awardIds: escolhas.map(({ award }) => award.id) })).map((linha) => [linha.awardId, linha.orderNumber]),
      );
      const pecas = new Map(
        (await repo.listPartsById(tx, org, [...itens.values()].flatMap((item) => (item.partId ? [item.partId] : [])))).map((peca) => [peca.id, peca]),
      );

      const skipped: PurchaseOrdersFromQuoteResult['skipped'] = [];
      const porFornecedor = new Map<string, { shippingCents: number; linhas: (PurchaseOrderLineInput & { awardId: string })[] }>();
      for (const { award } of escolhas) {
        const item = itens.get(award.requestItemId)!;
        const numero = jaPedidas.get(award.id);
        if (numero !== undefined) {
          skipped.push({ description: item.description, reason: `já está no pedido nº ${numero}` });
          continue;
        }
        const oferta = ofertas.get(award.responseItemId);
        if (!oferta || !isValidOffer({ ...oferta.linha, responseItemId: oferta.linha.id, supplierId: oferta.supplierId })) {
          skipped.push({ description: item.description, reason: 'a oferta escolhida não vale mais' });
          continue;
        }
        if (!item.partId || !pecas.has(item.partId)) {
          skipped.push({ description: item.description, reason: 'peça sem cadastro no catálogo' });
          continue;
        }
        const grupo = porFornecedor.get(oferta.supplierId) ?? { shippingCents: oferta.shippingCents ?? 0, linhas: [] };
        grupo.linhas.push({
          partId: item.partId,
          quantity: milliToNumber(milli(item.quantity)),
          unitCostCents: oferta.linha.unitPriceCents!,
          workOrderItemId: item.workOrderItemId,
          awardId: award.id,
        });
        porFornecedor.set(oferta.supplierId, grupo);
      }

      const criados: string[] = [];
      for (const [supplierId, grupo] of porFornecedor) {
        const fornecedor = await repo.findSupplier(tx, org, supplierId);
        if (!fornecedor || fornecedor.deletedAt) {
          for (const linha of grupo.linhas) {
            skipped.push({ description: pecas.get(linha.partId)!.name, reason: 'o fornecedor foi tirado da lista' });
          }
          continue;
        }
        // peça da OS que não pode mais ser comprada (OS encerrada, já em outro pedido)
        // entra no pedido sem o vínculo, em vez de travar a geração inteira
        const vinculaveis = await this.itensDaOsCompraveis(tx, org, grupo.linhas);
        const linhas = await this.montarLinhas(
          tx,
          org,
          grupo.linhas.map((linha) => ({ ...linha, workOrderItemId: vinculaveis.has(linha.workOrderItemId ?? '') ? linha.workOrderItemId : null })),
        );
        const number = await nextNumber(tx, org, COUNTER_PURCHASE_ORDER);
        const pedido = await repo.insertOrder(tx, {
          organizationId: org,
          number,
          supplierId,
          supplierQuoteRequestId: cotacao.id,
          shippingCents: grupo.shippingCents,
          createdBy: auth.userId,
        });
        await repo.replaceLines(
          tx,
          org,
          pedido.id,
          linhas.map((linha, indice) => ({ ...linha, purchaseOrderId: pedido.id, supplierQuoteAwardId: grupo.linhas[indice]!.awardId })),
        );
        criados.push(pedido.id);
      }

      if (!criados.length) {
        throw new AppError(
          422,
          ErrorCode.PURCHASE_ORDER_STATE,
          'Nada para pedir',
          `Nenhuma peça desta cotação pôde virar pedido: ${skipped.map((s) => `${s.description} (${s.reason})`).join('; ')}.`,
        );
      }

      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'purchase_order.created_from_quote',
        entityType: 'supplier_quote',
        entityId: cotacao.id,
        workOrderId: cotacao.workOrderId,
        metadata: { number: cotacao.number, orders: criados.length, skipped: skipped.length },
        ...client,
      });
      // uma consulta de cada vez: a mesma transação não aceita consultas em paralelo
      const orders: PurchaseOrder[] = [];
      for (const pedidoId of criados) orders.push(await this.carregar(tx, org, pedidoId));
      return { orders, skipped };
    });
  }

  // ============================== receber ====================================

  /**
   * A mercadoria chegou (decisões de 14/09/2026):
   * - entra no estoque com o custo da nota + a parte do frete (rateio pelo valor);
   * - o custo médio e o último custo da peça são recalculados;
   * - o preço da nota, sem frete, vai para o histórico de preço;
   * - a peça comprada para uma OS vira "do estoque" e, com o item aprovado, fica
   *   reservada para aquela OS na hora — outra OS não pega.
   *
   * Tudo numa transação, com o pedido e as peças travados. A mesma chave de
   * recebimento devolve o resultado do primeiro envio, sem dar entrada de novo.
   */
  async receive(auth: AuthContext, id: string, input: ReceivePurchaseOrderInput, client: ClientInfo): Promise<PurchaseOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const pedido = await repo.lockOrder(tx, org, id);
      if (!pedido) throw notFound('Pedido de compra não encontrado.');
      // o pedido travado serializa envios repetidos: o segundo já enxerga o primeiro
      const repetido = await repo.findReceiptByClientRequest(tx, org, input.clientRequestId);
      if (repetido) {
        if (repetido.purchaseOrderId !== pedido.id) throw chaveUsada();
        return this.carregar(tx, org, pedido.id);
      }
      assertPurchaseAction(pedido.status, 'receive');

      const linhas = await repo.listLines(tx, org, pedido.id);
      const linhaPorId = new Map(linhas.map((l) => [l.line.id, l]));
      const erros: FieldError[] = [];
      input.items.forEach((item, indice) => {
        const alvo = linhaPorId.get(item.purchaseOrderItemId);
        if (!alvo) {
          erros.push({ path: `body.items.${indice}.purchaseOrderItemId`, message: 'Peça não está neste pedido' });
          return;
        }
        const falta = remainingMilli({
          quantityMilli: milli(alvo.line.quantity),
          receivedMilli: milli(alvo.line.receivedQuantity),
          returnedMilli: milli(alvo.line.returnedQuantity),
        });
        if (parseQuantity(item.quantity)! > falta) {
          erros.push({
            path: `body.items.${indice}.quantity`,
            message: `Chegou mais do que falta: faltam ${formatQuantity(falta, alvo.unit.toLowerCase())}`,
          });
        }
      });
      if (erros.length) throw validationFailed(erros);

      const recebimento = await repo.insertReceipt(tx, {
        organizationId: org,
        purchaseOrderId: pedido.id,
        clientRequestId: input.clientRequestId,
        invoiceNumber: blankToNull(input.invoiceNumber) ?? null,
        shippingCents: input.shippingCents,
        notes: blankToNull(input.notes) ?? null,
        receivedBy: auth.userId,
      });

      const entradas = input.items.map((item) => {
        const quantityMilli = parseQuantity(item.quantity)!;
        return { ...item, quantityMilli, alvo: linhaPorId.get(item.purchaseOrderItemId)! };
      });
      const fretes = allocateFreight(
        entradas.map((e) => lineValueCents(e.quantityMilli, e.unitCostCents)),
        input.shippingCents,
      );

      const pecas = new Map(
        (await repo.lockParts(tx, org, [...new Set(entradas.map((e) => e.alvo.line.partId))].sort())).map((peca) => [
          peca.id,
          {
            row: peca,
            onHand: milli(peca.quantityOnHand),
            reserved: milli(peca.quantityReserved),
            average: peca.averageCostCents,
            last: peca.lastCostCents,
          },
        ]),
      );

      for (const [indice, entrada] of entradas.entries()) {
        const peca = pecas.get(entrada.alvo.line.partId)!;
        const freightCents = fretes[indice]!;
        const landed = landedUnitCostCents(entrada.quantityMilli, entrada.unitCostCents, freightCents);
        let movimentoId: string | null = null;
        if (peca.row.trackStock) {
          peca.average = weightedAverageCost({
            onHandMilli: peca.onHand,
            averageCostCents: peca.average,
            inMilli: entrada.quantityMilli,
            unitCostCents: landed,
          });
          peca.onHand += entrada.quantityMilli;
          const movimento = await repo.insertMovement(tx, {
            organizationId: org,
            partId: peca.row.id,
            type: 'PURCHASE_IN',
            quantity: milliToDecimal(entrada.quantityMilli),
            unitCostCents: landed,
            balanceAfter: milliToDecimal(peca.onHand),
            averageCostAfterCents: peca.average,
            purchaseOrderId: pedido.id,
            reason: `Pedido de compra nº ${pedido.number}`,
            createdBy: auth.userId,
          });
          movimentoId = movimento.id;
        }
        peca.last = landed;
        await repo.insertReceiptItem(tx, {
          organizationId: org,
          receiptId: recebimento.id,
          purchaseOrderItemId: entrada.alvo.line.id,
          quantity: milliToDecimal(entrada.quantityMilli),
          unitCostCents: entrada.unitCostCents,
          freightCents,
          landedUnitCostCents: landed,
          inventoryMovementId: movimentoId,
        });
        const recebido = milli(entrada.alvo.line.receivedQuantity) + entrada.quantityMilli;
        await repo.updateLine(tx, entrada.alvo.line.id, { receivedQuantity: milliToDecimal(recebido) });
        entrada.alvo.line.receivedQuantity = milliToDecimal(recebido);
      }

      // o preço que o fornecedor cobrou, sem frete: é o que se compara com cotação
      await repo.insertPriceHistory(
        tx,
        entradas
          .filter((e) => e.unitCostCents > 0)
          .map((e) => ({
            organizationId: org,
            partId: e.alvo.line.partId,
            supplierId: pedido.supplierId,
            priceCents: e.unitCostCents,
            source: 'PURCHASE' as const,
            purchaseOrderId: pedido.id,
          })),
      );

      // reserva para a OS, com o saldo já atualizado pela entrada
      const reservas = await this.reservarParaOs(tx, org, entradas, pecas);

      for (const peca of pecas.values()) {
        await repo.updatePart(tx, peca.row.id, {
          quantityOnHand: milliToDecimal(peca.onHand),
          quantityReserved: milliToDecimal(peca.reserved),
          averageCostCents: peca.average,
          lastCostCents: peca.last,
        });
      }

      const status = statusAfterReceipt(
        linhas.map(({ line }) => ({
          quantityMilli: milli(line.quantity),
          receivedMilli: milli(line.receivedQuantity),
          returnedMilli: milli(line.returnedQuantity),
        })),
      );
      await repo.updateOrder(tx, pedido.id, {
        status,
        receivedAt: status === 'RECEIVED' ? new Date() : pedido.receivedAt,
        version: pedido.version + 1,
      });

      // financeiro (E13): a nota que chegou vira conta a pagar. É por
      // RECEBIMENTO e não por pedido, porque o fornecedor cobra por nota —
      // entrega parcial vira duas contas, como na vida real
      await createPurchasePayable(tx, org, {
        purchaseOrderId: pedido.id,
        purchaseNumber: pedido.number,
        supplierId: pedido.supplierId,
        invoiceNumber: recebimento.invoiceNumber,
        amountCents:
          entradas.reduce((soma, e) => soma + lineValueCents(e.quantityMilli, e.unitCostCents), 0) + input.shippingCents,
        dueDate: input.payableDueDate,
        userId: auth.userId,
      });

      await this.avisarChegada(tx, org, pedido.number, auth.userId, reservas);
      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'purchase_order.received',
        entityType: 'purchase_order',
        entityId: pedido.id,
        metadata: {
          number: pedido.number,
          receiptId: recebimento.id,
          invoiceNumber: recebimento.invoiceNumber,
          shippingCents: input.shippingCents,
          items: input.items.length,
          status,
        },
        ...client,
      });
      return this.carregar(tx, org, pedido.id);
    });
  }

  // ============================== devolver ===================================

  /**
   * Devolução ao fornecedor: a correção de um recebimento. Sai do estoque pelo
   * custo com que ENTROU (média das entradas daquela linha), então receber e
   * devolver a mesma coisa volta o custo médio ao de antes. A reserva que a peça
   * tinha para uma OS é desfeita na mesma medida. O que voltou passa a faltar:
   * a peça certa ainda pode chegar no lugar da errada.
   */
  async returnItems(auth: AuthContext, id: string, input: ReturnPurchaseOrderInput, client: ClientInfo): Promise<PurchaseOrder> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const pedido = await repo.lockOrder(tx, org, id);
      if (!pedido) throw notFound('Pedido de compra não encontrado.');
      const repetida = await repo.findReturnByClientRequest(tx, org, input.clientRequestId);
      if (repetida) {
        if (repetida.purchaseOrderId !== pedido.id) throw chaveUsada();
        return this.carregar(tx, org, pedido.id);
      }
      assertPurchaseAction(pedido.status, 'return');

      const linhas = await repo.listLines(tx, org, pedido.id);
      const linhaPorId = new Map(linhas.map((l) => [l.line.id, l]));
      const custos = new Map(
        (await repo.landedCostsByLine(tx, org, pedido.id)).map((c) => [
          c.purchaseOrderItemId,
          Math.round(Number(c.value) / Number(c.quantity)),
        ]),
      );

      const erros: FieldError[] = [];
      input.items.forEach((item, indice) => {
        const alvo = linhaPorId.get(item.purchaseOrderItemId);
        if (!alvo) {
          erros.push({ path: `body.items.${indice}.purchaseOrderItemId`, message: 'Peça não está neste pedido' });
          return;
        }
        const pode = returnableMilli({ receivedMilli: milli(alvo.line.receivedQuantity), returnedMilli: milli(alvo.line.returnedQuantity) });
        if (parseQuantity(item.quantity)! > pode) {
          erros.push({
            path: `body.items.${indice}.quantity`,
            message: pode > 0 ? `Só dá para devolver ${formatQuantity(pode, alvo.unit.toLowerCase())}` : 'Nada desta peça chegou para devolver',
          });
        }
      });
      if (erros.length) throw validationFailed(erros);

      const saidas = input.items.map((item) => ({
        ...item,
        quantityMilli: parseQuantity(item.quantity)!,
        alvo: linhaPorId.get(item.purchaseOrderItemId)!,
      }));
      const pecas = new Map(
        (await repo.lockParts(tx, org, [...new Set(saidas.map((s) => s.alvo.line.partId))].sort())).map((peca) => [
          peca.id,
          { row: peca, onHand: milli(peca.quantityOnHand), reserved: milli(peca.quantityReserved), average: peca.averageCostCents },
        ]),
      );

      // a reserva para a OS sai primeiro: peça devolvida não pode continuar prometida
      const itensOs = new Map(
        (await repo.lockWorkOrderItems(tx, org, saidas.flatMap((s) => (s.alvo.line.workOrderItemId ? [s.alvo.line.workOrderItemId] : [])))).map((r) => [
          r.item.id,
          r,
        ]),
      );

      const devolucao = await repo.insertReturn(tx, {
        organizationId: org,
        purchaseOrderId: pedido.id,
        clientRequestId: input.clientRequestId,
        reason: input.reason.trim(),
        returnedBy: auth.userId,
      });

      const porOs = new Map<string, { number: number; textos: string[] }>();
      let valorDevolvidoCents = 0;
      for (const saida of saidas) {
        const peca = pecas.get(saida.alvo.line.partId)!;
        const custo = custos.get(saida.alvo.line.id) ?? saida.alvo.line.unitCostCents;
        valorDevolvidoCents += lineValueCents(saida.quantityMilli, custo);

        const itemOs = saida.alvo.line.workOrderItemId ? itensOs.get(saida.alvo.line.workOrderItemId) : undefined;
        if (itemOs && itemOs.item.stockStatus !== 'CONSUMED') {
          const reservadoNoItem = milli(itemOs.item.reservedQuantity);
          const solta = Math.min(reservadoNoItem, saida.quantityMilli);
          if (solta > 0) {
            const resta = reservadoNoItem - solta;
            peca.reserved = Math.max(0, peca.reserved - solta);
            await repo.updateWorkOrderItem(tx, itemOs.item.id, {
              reservedQuantity: milliToDecimal(resta),
              stockStatus: resta > 0 ? 'PARTIAL' : 'NONE',
            });
            itemOs.item.reservedQuantity = milliToDecimal(resta);
          }
          const grupo = porOs.get(itemOs.workOrder.id) ?? { number: itemOs.workOrder.number, textos: [] };
          grupo.textos.push(`${saida.alvo.line.description} (${formatQuantity(saida.quantityMilli, saida.alvo.unit.toLowerCase())})`);
          porOs.set(itemOs.workOrder.id, grupo);
        }

        let movimentoId: string | null = null;
        if (peca.row.trackStock) {
          peca.average = averageCostAfterReturn({
            onHandMilli: peca.onHand,
            averageCostCents: peca.average,
            outMilli: saida.quantityMilli,
            unitCostCents: custo,
          });
          peca.onHand -= saida.quantityMilli;
          const movimento = await repo.insertMovement(tx, {
            organizationId: org,
            partId: peca.row.id,
            type: 'SUPPLIER_RETURN',
            quantity: milliToDecimal(-saida.quantityMilli),
            unitCostCents: custo,
            balanceAfter: milliToDecimal(peca.onHand),
            averageCostAfterCents: peca.average,
            purchaseOrderId: pedido.id,
            reason: `Devolução do pedido nº ${pedido.number}: ${input.reason.trim()}`,
            createdBy: auth.userId,
          });
          movimentoId = movimento.id;
        }
        await repo.insertReturnItem(tx, {
          organizationId: org,
          returnId: devolucao.id,
          purchaseOrderItemId: saida.alvo.line.id,
          quantity: milliToDecimal(saida.quantityMilli),
          unitCostCents: custo,
          inventoryMovementId: movimentoId,
        });
        const devolvido = milli(saida.alvo.line.returnedQuantity) + saida.quantityMilli;
        await repo.updateLine(tx, saida.alvo.line.id, { returnedQuantity: milliToDecimal(devolvido) });
        saida.alvo.line.returnedQuantity = milliToDecimal(devolvido);
      }

      for (const peca of pecas.values()) {
        await repo.updatePart(tx, peca.row.id, {
          quantityOnHand: milliToDecimal(peca.onHand),
          quantityReserved: milliToDecimal(peca.reserved),
          averageCostCents: peca.average,
        });
      }

      // encerrado com falta continua encerrado; senão, a situação segue o líquido
      const status = pedido.closedShortAt
        ? pedido.status
        : statusAfterReceipt(
            linhas.map(({ line }) => ({
              quantityMilli: milli(line.quantity),
              receivedMilli: milli(line.receivedQuantity),
              returnedMilli: milli(line.returnedQuantity),
            })),
          );
      await repo.updateOrder(tx, pedido.id, {
        status,
        receivedAt: status === 'RECEIVED' ? pedido.receivedAt : null,
        version: pedido.version + 1,
      });

      // financeiro (E13): o que voltou ao fornecedor sai da conta a pagar,
      // da nota mais recente para a mais antiga e nunca abaixo do que já foi
      // pago (crédito com o fornecedor é assunto do V3)
      await reducePurchasePayable(tx, org, pedido.id, valorDevolvidoCents, auth.userId);

      for (const [workOrderId, grupo] of porOs) {
        await workOrderRepo.insertEvent(tx, {
          organizationId: org,
          workOrderId,
          type: 'NOTE',
          data: {
            text: `Devolvido ao fornecedor (pedido de compra nº ${pedido.number}): ${grupo.textos.join(', ')}. Motivo: ${input.reason.trim()}. A peça volta a faltar para esta OS.`,
          },
          actorUserId: auth.userId,
        });
      }
      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'purchase_order.returned',
        entityType: 'purchase_order',
        entityId: pedido.id,
        metadata: { number: pedido.number, returnId: devolucao.id, reason: input.reason.trim(), items: input.items.length, status },
        ...client,
      });
      return this.carregar(tx, org, pedido.id);
    });
  }

  /**
   * A peça que chegou para uma OS: vira "do estoque" e, se o item já foi aprovado
   * pelo cliente, é reservada até a quantidade do item, limitada ao que há
   * disponível. Item em rascunho reserva na aprovação, como qualquer peça.
   */
  private async reservarParaOs(
    tx: Tx,
    org: string,
    entradas: readonly { quantityMilli: number; alvo: { line: { workOrderItemId: string | null; partId: string; description: string }; unit: string } }[],
    pecas: Map<string, { row: { trackStock: boolean }; onHand: number; reserved: number }>,
  ) {
    const ids = entradas.flatMap((e) => (e.alvo.line.workOrderItemId ? [e.alvo.line.workOrderItemId] : []));
    const itens = new Map((await repo.lockWorkOrderItems(tx, org, ids)).map((r) => [r.item.id, r]));
    const resultado: { workOrderId: string; workOrderNumber: number; texto: string; reservado: boolean }[] = [];
    for (const entrada of entradas) {
      const registro = entrada.alvo.line.workOrderItemId ? itens.get(entrada.alvo.line.workOrderItemId) : undefined;
      if (!registro) continue;
      const { item, workOrder } = registro;
      // OS que acabou ou peça que já saiu: a compra fica no estoque, sem reserva
      if (workOrder.status === 'DELIVERED' || workOrder.status === 'CANCELED' || item.stockStatus === 'CONSUMED') continue;
      const peca = pecas.get(entrada.alvo.line.partId)!;
      const texto = `${entrada.alvo.line.description} (${formatQuantity(entrada.quantityMilli, entrada.alvo.unit.toLowerCase())})`;

      const mudancas: Partial<typeof item> = {};
      if (item.sourcing === 'TO_ORDER') mudancas.sourcing = 'STOCK';
      let reservado = false;
      if (item.approvalStatus === 'APPROVED' && peca.row.trackStock) {
        const jaReservado = milli(item.reservedQuantity);
        const precisa = Math.max(0, milli(item.quantity) - jaReservado);
        const disponivel = Math.max(0, peca.onHand - peca.reserved);
        const reserva = Math.min(precisa, entrada.quantityMilli, disponivel);
        if (reserva > 0) {
          const total = jaReservado + reserva;
          peca.reserved += reserva;
          mudancas.reservedQuantity = milliToDecimal(total);
          mudancas.stockStatus = total >= milli(item.quantity) ? 'RESERVED' : 'PARTIAL';
          item.reservedQuantity = milliToDecimal(total);
          reservado = true;
        }
      }
      if (Object.keys(mudancas).length) await repo.updateWorkOrderItem(tx, item.id, mudancas);
      resultado.push({ workOrderId: workOrder.id, workOrderNumber: workOrder.number, texto, reservado });
    }
    return resultado;
  }

  /** Timeline de cada OS atendida e o sino de quem cuida do andamento das OS. */
  private async avisarChegada(
    tx: Tx,
    org: string,
    numeroPedido: number,
    userId: string,
    chegadas: readonly { workOrderId: string; workOrderNumber: number; texto: string; reservado: boolean }[],
  ) {
    const porOs = new Map<string, { number: number; reservadas: string[]; aguardando: string[] }>();
    for (const chegada of chegadas) {
      const grupo = porOs.get(chegada.workOrderId) ?? { number: chegada.workOrderNumber, reservadas: [], aguardando: [] };
      (chegada.reservado ? grupo.reservadas : grupo.aguardando).push(chegada.texto);
      porOs.set(chegada.workOrderId, grupo);
    }
    if (!porOs.size) return;
    const equipe = (await quoteRepo.teamMembers(tx, org)).filter((membro) => can(membro.role, 'work_orders:change_status'));
    for (const [workOrderId, grupo] of porOs) {
      const partes = [
        grupo.reservadas.length && `${grupo.reservadas.join(', ')} — reservada para esta OS`,
        grupo.aguardando.length && `${grupo.aguardando.join(', ')} — entra no estoque; a reserva acontece quando o orçamento for aprovado`,
      ].filter(Boolean);
      const texto = `Chegou do pedido de compra nº ${numeroPedido}: ${partes.join('; ')}.`;
      await workOrderRepo.insertEvent(tx, {
        organizationId: org,
        workOrderId,
        type: 'PURCHASE_RECEIVED',
        data: { text: texto, number: numeroPedido },
        actorUserId: userId,
      });
      await quoteRepo.insertNotifications(
        tx,
        equipe
          .filter((membro) => membro.userId !== userId)
          .map((membro) => ({
            organizationId: org,
            userId: membro.userId,
            type: 'PURCHASE_RECEIVED' as const,
            title: `Peça chegou — OS ${grupo.number}`,
            body: texto,
            link: `/ordens/${grupo.number}`,
            workOrderId,
          })),
      );
    }
  }

  // ======================= sugestão e históricos ============================

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

  // ================================ apoio ====================================

  private async fornecedorAtivo(tx: Tx, org: string, supplierId: string, path: string) {
    const fornecedor = await repo.findSupplier(tx, org, supplierId);
    if (!fornecedor || fornecedor.deletedAt) throw validationFailed([{ path, message: 'Fornecedor não encontrado' }]);
    return fornecedor;
  }

  /** Confere cada linha e devolve o que vai para o banco (nome e código do cadastro). */
  private async montarLinhas(tx: Tx, org: string, entrada: readonly PurchaseOrderLineInput[], exceptOrderId?: string) {
    const pecas = new Map((await repo.listPartsById(tx, org, [...new Set(entrada.map((linha) => linha.partId))])).map((peca) => [peca.id, peca]));
    const erros: FieldError[] = [];
    entrada.forEach((linha, indice) => {
      if (!pecas.has(linha.partId)) erros.push({ path: `body.items.${indice}.partId`, message: 'Peça não encontrada' });
    });
    if (erros.length) throw validationFailed(erros);
    await this.conferirItensDaOs(
      tx,
      org,
      entrada.map((linha, indice) => ({ indice, partId: linha.partId, workOrderItemId: linha.workOrderItemId ?? null })),
      exceptOrderId,
    );
    return entrada.map((linha, indice) => {
      const peca = pecas.get(linha.partId)!;
      return {
        organizationId: org,
        partId: peca.id,
        workOrderItemId: linha.workOrderItemId ?? null,
        description: peca.name,
        partCode: peca.manufacturerCode,
        quantity: milliToDecimal(parseQuantity(linha.quantity)!),
        unitCostCents: linha.unitCostCents ?? 0,
        position: indice + 1,
      };
    });
  }

  /**
   * A peça da OS só entra se é peça, é a mesma do pedido, não é do cliente, a OS
   * não acabou, ainda não saiu do estoque e não está em outro pedido vivo.
   */
  private async conferirItensDaOs(
    tx: Tx,
    org: string,
    linhas: readonly { indice: number; partId: string; workOrderItemId: string | null }[],
    exceptOrderId?: string,
  ) {
    const comOs = linhas.filter((linha) => linha.workOrderItemId);
    if (!comOs.length) return;
    const ids = comOs.map((linha) => linha.workOrderItemId!);
    const itens = new Map((await repo.listWorkOrderItemsForPurchase(tx, org, ids)).map((item) => [item.id, item]));
    const emPedido = new Map((await repo.listActiveLines(tx, org, { workOrderItemIds: ids }, exceptOrderId)).map((l) => [l.workOrderItemId, l.orderNumber]));
    const erros: FieldError[] = [];
    for (const linha of comOs) {
      const path = `body.items.${linha.indice}.workOrderItemId`;
      const item = itens.get(linha.workOrderItemId!);
      const motivo = !item
        ? 'Peça da OS não encontrada'
        : item.type !== 'PART'
          ? 'Só peça se compra'
          : item.partId !== linha.partId
            ? 'A peça da OS é outra'
            : item.sourcing === 'CUSTOMER_PROVIDED'
              ? 'Peça trazida pelo cliente não se compra'
              : item.workOrderStatus === 'DELIVERED' || item.workOrderStatus === 'CANCELED'
                ? `A OS ${item.workOrderNumber} já foi encerrada`
                : item.stockStatus === 'CONSUMED'
                  ? 'Esta peça da OS já saiu do estoque'
                  : emPedido.has(linha.workOrderItemId!)
                    ? `Esta peça da OS já está no pedido nº ${emPedido.get(linha.workOrderItemId!)}`
                    : null;
      if (motivo) erros.push({ path, message: motivo });
    }
    if (erros.length) throw validationFailed(erros);
  }

  /** Quais itens de OS de uma lista ainda podem ser vinculados (usado ao gerar da cotação). */
  private async itensDaOsCompraveis(tx: Tx, org: string, linhas: readonly { partId: string; workOrderItemId?: string | null }[]) {
    const ids = linhas.flatMap((linha) => (linha.workOrderItemId ? [linha.workOrderItemId] : []));
    const itens = await repo.listWorkOrderItemsForPurchase(tx, org, ids);
    const emPedido = new Set((await repo.listActiveLines(tx, org, { workOrderItemIds: ids })).map((l) => l.workOrderItemId));
    const porId = new Map(linhas.map((linha) => [linha.workOrderItemId, linha.partId]));
    return new Set(
      itens
        .filter(
          (item) =>
            item.type === 'PART' &&
            item.partId === porId.get(item.id) &&
            item.sourcing !== 'CUSTOMER_PROVIDED' &&
            item.workOrderStatus !== 'DELIVERED' &&
            item.workOrderStatus !== 'CANCELED' &&
            item.stockStatus !== 'CONSUMED' &&
            !emPedido.has(item.id),
        )
        .map((item) => item.id),
    );
  }

  /** Nota na timeline das OS atendidas por um pedido. */
  private async avisarOs(tx: Tx, org: string, orderId: string, userId: string, texto: string, soQuemFaltou = false) {
    const linhas = await repo.listLines(tx, org, orderId);
    const oss = new Set(
      linhas
        .filter(({ line, workOrder }) => workOrder?.id && (!soQuemFaltou || milli(line.receivedQuantity) < milli(line.quantity)))
        .map(({ workOrder }) => workOrder!.id),
    );
    for (const workOrderId of oss) {
      await workOrderRepo.insertEvent(tx, { organizationId: org, workOrderId, type: 'NOTE', data: { text: texto }, actorUserId: userId });
    }
  }

  async carregar(tx: Tx, org: string, id: string): Promise<PurchaseOrder> {
    const found = await repo.findOrder(tx, org, id);
    if (!found) throw notFound('Pedido de compra não encontrado.');
    const { order } = found;
    const linhas = await repo.listLines(tx, org, id);
    const recebimentos = await repo.listReceipts(tx, org, id);
    const devolucoes = await repo.listReturns(tx, org, id);
    const totais = purchaseOrderTotals(
      linhas.map(({ line }) => ({ quantityMilli: milli(line.quantity), unitCostCents: line.unitCostCents })),
      order.shippingCents,
    );
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      supplier: {
        id: found.supplier.id,
        name: found.supplier.name,
        whatsapp: found.supplier.whatsapp,
        contactName: found.supplier.contactName,
        removed: found.supplier.deletedAt !== null,
      },
      supplierQuote: order.supplierQuoteRequestId && found.quoteNumber !== null ? { id: order.supplierQuoteRequestId, number: found.quoteNumber } : null,
      expectedOn: order.expectedOn,
      shippingCents: order.shippingCents,
      notes: order.notes,
      itemsTotalCents: totais.itemsTotalCents,
      totalCents: totais.totalCents,
      createdAt: order.createdAt.toISOString(),
      createdBy: order.createdBy && found.createdByName ? { id: order.createdBy, name: found.createdByName } : null,
      orderedAt: isoOrNull(order.orderedAt),
      orderedBy: order.orderedBy && found.orderedByName ? { id: order.orderedBy, name: found.orderedByName } : null,
      receivedAt: isoOrNull(order.receivedAt),
      closedShortAt: isoOrNull(order.closedShortAt),
      closeReason: order.closeReason,
      canceledAt: isoOrNull(order.canceledAt),
      cancelReason: order.cancelReason,
      version: order.version,
      items: linhas.map(({ line, unit, workOrder, vehicle }) => ({
        id: line.id,
        partId: line.partId,
        description: line.description,
        partCode: line.partCode,
        unit,
        quantity: milliToNumber(milli(line.quantity)),
        unitCostCents: line.unitCostCents,
        lineTotalCents: lineValueCents(milli(line.quantity), line.unitCostCents),
        receivedQuantity: milliToNumber(milli(line.receivedQuantity)),
        returnedQuantity: milliToNumber(milli(line.returnedQuantity)),
        pendingQuantity: milliToNumber(
          remainingMilli({
            quantityMilli: milli(line.quantity),
            receivedMilli: milli(line.receivedQuantity),
            returnedMilli: milli(line.returnedQuantity),
          }),
        ),
        workOrder:
          workOrder?.id && line.workOrderItemId
            ? {
                id: workOrder.id,
                number: workOrder.number,
                itemId: line.workOrderItemId,
                vehicleLabel: [vehicle?.make, vehicle?.model].filter(Boolean).join(' ') + (vehicle?.plate ? ` · ${vehicle.plate}` : ''),
              }
            : null,
        supplierQuoteAwardId: line.supplierQuoteAwardId,
      })),
      receipts: recebimentos.map(({ receipt, receivedByName, items }) => ({
        id: receipt.id,
        receivedAt: receipt.receivedAt.toISOString(),
        receivedBy: receivedByName ? { id: receipt.receivedBy, name: receivedByName } : null,
        invoiceNumber: receipt.invoiceNumber,
        shippingCents: receipt.shippingCents,
        notes: receipt.notes,
        items: items.map(({ item, description }) => ({
          purchaseOrderItemId: item.purchaseOrderItemId,
          description,
          quantity: milliToNumber(milli(item.quantity)),
          unitCostCents: item.unitCostCents,
          freightCents: item.freightCents,
          landedUnitCostCents: item.landedUnitCostCents,
        })),
      })),
      returns: devolucoes.map(({ ret, returnedByName, items }) => ({
        id: ret.id,
        returnedAt: ret.returnedAt.toISOString(),
        returnedBy: returnedByName ? { id: ret.returnedBy, name: returnedByName } : null,
        reason: ret.reason,
        items: items.map(({ item, description }) => ({
          purchaseOrderItemId: item.purchaseOrderItemId,
          description,
          quantity: milliToNumber(milli(item.quantity)),
          unitCostCents: item.unitCostCents,
        })),
      })),
    };
  }
}

function chaveUsada() {
  return new AppError(
    409,
    ErrorCode.CONFLICT,
    'Envio já usado',
    'Este envio já foi registrado em outro pedido. Recarregue a página e tente de novo.',
  );
}

function versaoMudou() {
  return new AppError(
    409,
    ErrorCode.PURCHASE_ORDER_VERSION_CONFLICT,
    'O pedido mudou',
    'Alguém alterou este rascunho enquanto você editava. Recarregue para ver a versão atual.',
  );
}
