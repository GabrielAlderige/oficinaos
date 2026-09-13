import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  can,
  canonicalQuotePayload,
  type CreateQuoteInput,
  computeApprovedTotals,
  DEFAULT_QUOTE_VALIDITY_DAYS,
  effectiveQuoteStatus,
  ErrorCode,
  isQuoteAnswerable,
  type ManualDecisionInput,
  milliToNumber,
  type Page,
  parseQuantity,
  type PublicApproveInput,
  type PublicQuote,
  type Quote,
  type QuoteItem,
  type QuoteListItem,
  quoteValidUntil,
  type ShareChannel,
  whatsappLink,
  whatsappQuoteMessage,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { COUNTER_QUOTE, nextNumber } from '../../core/counters';
import { AppError, notFound, validationFailed } from '../../core/errors';
import { blankToNull, isoOrNull } from '../../core/normalize';
import { releaseReservations, reserveApprovedItems } from '../../core/reservations';
import { organizations, quotes as quotesTable, type QuoteSnapshot } from '../../db/schema';
import type { Tx } from '../../db/tenant';
import { withQuoteToken, withTenant } from '../../db/tenant';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import { applyWorkOrderChange } from '../work-orders/totals';
import * as repo from './quotes.repository';

const milli = (value: string) => parseQuantity(value) ?? 0;

/** 32 bytes aleatórios: é a credencial da página pública, não um id adivinhável. */
const newPublicToken = () => randomBytes(32).toString('base64url');

const sha256 = (payload: string) => createHash('sha256').update(payload).digest('hex');

function conflict(detail: string) {
  return new AppError(409, ErrorCode.CONFLICT, 'O orçamento mudou', detail);
}

export class QuotesService {
  constructor(private readonly deps: ServiceDeps) {}

  // ------------------------------------------------------------ na oficina

  /**
   * Enviar orçamento: congela os itens em rascunho (ARCHITECTURE §8.1, passo 2).
   * O que o cliente vê não muda mais — mexer num item pendente gera versão nova.
   */
  async create(auth: AuthContext, workOrderId: string, input: CreateQuoteInput, client: ClientInfo): Promise<Quote> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const order = await workOrderRepo.lockWorkOrder(tx, auth.organizationId, workOrderId);
      if (!order) throw notFound('OS não encontrada.');

      const drafts = await repo.listDraftItems(tx, auth.organizationId, workOrderId);
      const chosen = input.itemIds.length ? drafts.filter((item) => input.itemIds.includes(item.id)) : drafts;
      if (!chosen.length) {
        throw validationFailed([{ path: 'body.itemIds', message: 'A OS não tem itens novos para orçar' }]);
      }

      // um link valendo por OS: o anterior vira "substituído" e leva ao novo
      const previous = await repo.findOpenQuote(tx, auth.organizationId, workOrderId);
      const version = (await repo.lastVersionOf(tx, auth.organizationId, workOrderId)) + 1;
      const header = await workOrderRepo.findWorkOrder(tx, auth.organizationId, { id: workOrderId });
      if (!header) throw notFound('OS não encontrada.');

      const snapshot: QuoteSnapshot = {
        shop: await this.shopSnapshot(tx, auth.organizationId),
        customer: { name: header.customer.name },
        vehicle: {
          make: header.vehicle.make,
          model: header.vehicle.model,
          version: header.vehicle.version,
          plate: header.vehicle.plate,
          yearLabel: header.vehicle.yearManufacture
            ? `${header.vehicle.yearManufacture}/${header.vehicle.yearModel ?? header.vehicle.yearManufacture}`
            : null,
        },
        message: blankToNull(input.message),
        warranty: { days: order.warrantyDays, km: order.warrantyKm },
      };

      const subtotal = chosen.reduce((total, item) => total + item.totalCents, 0);
      const number = await nextNumber(tx, auth.organizationId, COUNTER_QUOTE);
      const validUntil = quoteValidUntil(new Date(), input.validityDays || DEFAULT_QUOTE_VALIDITY_DAYS);

      // O anterior sai de "enviado" ANTES de o novo entrar: o índice parcial
      // `quotes_one_open_per_work_order` só admite um link valendo por OS, e é
      // ele que garante que o cliente nunca receba dois orçamentos abertos.
      if (previous) await repo.updateQuote(tx, previous.id, { status: 'SUPERSEDED' });

      const quote = await repo.insertQuote(tx, {
        organizationId: auth.organizationId,
        number,
        workOrderId,
        version,
        kind: previous || version > 1 ? 'SUPPLEMENTARY' : 'INITIAL',
        publicToken: newPublicToken(),
        validUntil,
        snapshot,
        contentHash: 'pendente',
        subtotalCents: subtotal,
        discountCents: 0,
        surchargeCents: 0,
        totalCents: subtotal,
        sentBy: auth.userId,
      });

      const items = await repo.insertQuoteItems(
        tx,
        chosen.map((item, index) => ({
          organizationId: auth.organizationId,
          quoteId: quote.id,
          workOrderItemId: item.id,
          type: item.type,
          description: item.description,
          partCode: item.partCode,
          brand: item.brand,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.discountCents,
          totalCents: item.totalCents,
          isOptional: item.isOptional,
          position: index + 1,
        })),
      );

      // o hash cobre snapshot + itens: é a prova de QUAL versão o cliente aprovou
      const contentHash = sha256(
        canonicalQuotePayload({
          number,
          version,
          validUntil: validUntil.toISOString(),
          subtotalCents: subtotal,
          discountCents: 0,
          surchargeCents: 0,
          totalCents: subtotal,
          items: items.map((item) => ({
            position: item.position,
            type: item.type,
            description: item.description,
            quantityMilli: milli(item.quantity),
            unitPriceCents: item.unitPriceCents,
            discountCents: item.discountCents,
            totalCents: item.totalCents,
            isOptional: item.isOptional,
          })),
        }),
      );
      const saved = await repo.updateQuote(tx, quote.id, { contentHash });

      // as fotos que a oficina marcou como visíveis vão junto, por item
      const photos = await repo.listVisibleWorkOrderAttachments(tx, auth.organizationId, workOrderId);
      const byWorkOrderItem = new Map(items.map((item) => [item.workOrderItemId, item.id]));
      await repo.insertQuoteAttachments(
        tx,
        photos.map((photo, index) => ({
          organizationId: auth.organizationId,
          quoteId: quote.id,
          attachmentId: photo.id,
          quoteItemId: photo.workOrderItemId ? (byWorkOrderItem.get(photo.workOrderItemId) ?? null) : null,
          caption: photo.caption,
          position: index + 1,
        })),
      );

      await repo.setItemsApprovalStatus(tx, auth.organizationId, chosen.map((item) => item.id), 'PENDING');
      // agora que o novo existe, o antigo pode apontar para ele (o link velho leva ao novo)
      if (previous) await repo.updateQuote(tx, previous.id, { supersededByQuoteId: quote.id });

      // a OS passa a aguardar aprovação (transição automática da máquina de estados)
      const fresh = await workOrderRepo.lockWorkOrder(tx, auth.organizationId, workOrderId);
      await applyWorkOrderChange(tx, fresh!, { status: 'AWAITING_APPROVAL' });

      await workOrderRepo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId,
        type: 'QUOTE_SENT',
        data: { quoteNumber: number, version, totalCents: subtotal, itemCount: items.length },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'quote.sent',
        entityType: 'quote',
        entityId: quote.id,
        metadata: { number, version, totalCents: subtotal },
        ...client,
      });

      return this.load(tx, auth.organizationId, saved.id);
    });
  }

  async get(auth: AuthContext, id: string): Promise<Quote> {
    return withTenant(this.deps.db, auth, (tx) => this.load(tx, auth.organizationId, id));
  }

  async list(auth: AuthContext, query: { status: 'open' | 'all' | Quote['status']; page: number; pageSize: number }): Promise<Page<QuoteListItem>> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const { rows, total } = await repo.listQuotes(tx, auth.organizationId, {
        status: query.status,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      return {
        data: rows.map((row) => ({
          id: row.quote.id,
          number: row.quote.number,
          workOrderId: row.quote.workOrderId,
          workOrderNumber: row.workOrderNumber,
          status: effectiveQuoteStatus(row.quote.status, row.quote.validUntil.toISOString()),
          kind: row.quote.kind,
          customerName: row.customerName,
          vehiclePlate: row.vehiclePlate,
          vehicleName: `${row.vehicleMake} ${row.vehicleModel}`,
          totalCents: row.quote.totalCents,
          validUntil: row.quote.validUntil.toISOString(),
          sentAt: row.quote.sentAt.toISOString(),
          firstViewedAt: isoOrNull(row.quote.firstViewedAt),
          viewCount: row.quote.viewCount,
        })),
        meta: { page: query.page, pageSize: query.pageSize, total },
      };
    });
  }

  /** Registra o canal de envio e devolve a mensagem pronta do WhatsApp. */
  async share(auth: AuthContext, id: string, channel: ShareChannel, client: ClientInfo): Promise<{ quote: Quote; message: string; whatsappUrl: string | null }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const found = await repo.findQuote(tx, auth.organizationId, id);
      if (!found) throw notFound('Orçamento não encontrado.');

      const link = this.publicUrl(found.quote.publicToken);
      const message = whatsappQuoteMessage({
        customerName: found.customerName,
        shopName: found.quote.snapshot.shop.name,
        vehicle: { make: found.vehicleMake, model: found.vehicleModel, plate: found.vehiclePlate },
        totalCents: found.quote.totalCents,
        link,
      });
      // o número é o do CLIENTE: o link abre a conversa com quem vai decidir.
      // Antes saía o da própria oficina, enquanto a tela dizia "o cliente não
      // tem WhatsApp cadastrado" — promessa que o dado não cumpria.
      const whatsapp = found.customerWhatsapp ?? null;

      await repo.updateQuote(tx, id, { sentChannel: channel });
      await repo.insertMessage(tx, {
        organizationId: auth.organizationId,
        customerId: found.customerId,
        channel: channel === 'WHATSAPP_LINK' ? 'WHATSAPP_LINK' : 'PUBLIC_PAGE',
        direction: 'OUTBOUND',
        templateKey: 'QUOTE_SENT',
        body: message,
        toAddress: whatsapp,
        workOrderId: found.quote.workOrderId,
        quoteId: id,
        // o link wa.me não confirma entrega: LINK_OPENED é o que realmente sabemos
        status: 'LINK_OPENED',
        sentBy: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'quote.shared',
        entityType: 'quote',
        entityId: id,
        metadata: { channel },
        ...client,
      });

      return {
        quote: await this.load(tx, auth.organizationId, id),
        message,
        // E.164 no banco: concatenar "55" aqui gerava `wa.me/55+55…` (link morto)
        whatsappUrl: whatsapp ? whatsappLink(whatsapp, message) : null,
      };
    });
  }

  /**
   * Decisão registrada pela equipe (telefone, balcão, WhatsApp). É a realidade
   * da oficina: metade dos clientes responde "pode fazer" por telefone. A
   * prova aqui é QUEM registrou, não uma assinatura do cliente.
   */
  async manualDecision(auth: AuthContext, id: string, input: ManualDecisionInput, client: ClientInfo): Promise<Quote> {
    if (!can(auth.role, 'quotes:record_manual_approval')) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Sem permissão', 'Seu acesso não permite registrar a resposta do cliente.');
    }
    return withTenant(this.deps.db, auth, async (tx) => {
      const quote = await repo.lockQuote(tx, id);
      if (!quote || quote.organizationId !== auth.organizationId) throw notFound('Orçamento não encontrado.');
      this.assertAnswerable(quote);

      const items = await repo.listQuoteItems(tx, id);
      const approvedIds =
        input.decision === 'APPROVED'
          ? items.map((item) => item.id)
          : input.decision === 'REJECTED'
            ? []
            : items.filter((item) => input.approvedItemIds.includes(item.id)).map((item) => item.id);

      return this.settle(tx, auth.organizationId, quote, {
        decision: input.decision,
        channel: input.channel,
        approvedQuoteItemIds: approvedIds,
        // blankToNull devolve undefined quando o campo não vem; a prova grava null
        signerName: blankToNull(input.signerName) ?? null,
        rejectionReason: input.decision === 'REJECTED' ? (blankToNull(input.notes) ?? null) : null,
        contentHash: quote.contentHash,
        recordedByUserId: auth.userId,
        actorUserId: auth.userId,
        client,
      });
    });
  }

  // --------------------------------------------------- página do cliente

  /**
   * Fase 1 de toda ação pública: o token resolve A QUE OFICINA o orçamento
   * pertence, lendo uma única linha de `quotes` (policy `quote_by_token`).
   *
   * O token prova "alguém tem o endereço deste orçamento" — o link vai por
   * WhatsApp e pode ser encaminhado. Ele não é chave da oficina: tudo o que
   * vem depois roda com contexto normal de oficina, resolvido a partir daqui.
   */
  private async resolveToken(token: string): Promise<{ organizationId: string; id: string }> {
    const row = await withQuoteToken(this.deps.db, token, async (tx) => {
      const [found] = await tx
        .select({ id: quotesTable.id, organizationId: quotesTable.organizationId })
        .from(quotesTable)
        .where(eq(quotesTable.publicToken, token))
        .limit(1);
      return found;
    });
    if (!row) throw notFound('Orçamento não encontrado.');
    return row;
  }

  /**
   * Leitura pública pelo token (§8.2). Versão substituída devolve o token novo:
   * o link antigo continua servindo, e o cliente só precisa de um link.
   */
  async publicView(token: string, client: ClientInfo): Promise<PublicQuote | { redirectToken: string }> {
    const { organizationId, id } = await this.resolveToken(token);
    void client;

    return withTenant(this.deps.db, { organizationId }, async (tx) => {
      const found = await repo.findQuote(tx, organizationId, id);
      if (!found) throw notFound('Orçamento não encontrado.');

      if (found.quote.status === 'SUPERSEDED' && found.quote.supersededByQuoteId) {
        const [next] = await tx
          .select({ token: quotesTable.publicToken })
          .from(quotesTable)
          .where(eq(quotesTable.id, found.quote.supersededByQuoteId))
          .limit(1);
        if (next) return { redirectToken: next.token };
      }

      // visualização registrada: a oficina sabe se o cliente abriu (§8.1)
      const first = found.quote.firstViewedAt === null;
      await repo.updateQuote(tx, found.quote.id, {
        firstViewedAt: found.quote.firstViewedAt ?? new Date(),
        lastViewedAt: new Date(),
        viewCount: found.quote.viewCount + 1,
      });
      if (first) {
        await workOrderRepo.insertEvent(tx, {
          organizationId,
          workOrderId: found.quote.workOrderId,
          type: 'QUOTE_VIEWED',
          data: { quoteNumber: found.quote.number },
          actorType: 'CUSTOMER',
        });
        await this.notify(tx, found, 'QUOTE_VIEWED', 'Orçamento visualizado', `${found.customerName} abriu o orçamento ${found.quote.number}.`);
      }

      return this.toPublicDto(tx, found);
    });
  }

  /**
   * Aprovação pelo link: a transação do §8.1, na ordem exata. Trava, validação
   * e escrita ficam TODAS na mesma transação — a fase do token só resolveu a
   * oficina e não decidiu nada.
   */
  async publicApprove(token: string, input: PublicApproveInput, client: ClientInfo): Promise<PublicQuote> {
    const { organizationId, id } = await this.resolveToken(token);

    return withTenant(this.deps.db, { organizationId }, async (tx) => {
      // 1) trava o orçamento: duas abas não aprovam ao mesmo tempo
      const quote = await repo.lockQuote(tx, id);
      if (!quote) throw notFound('Orçamento não encontrado.');

      // idempotência: um segundo toque devolve a mesma resposta, sem aprovar de novo
      if (await repo.findApproval(tx, quote.id)) return this.toPublicDto(tx, await this.reload(tx, quote.id));

      // 2) valida: enviado, dentro do prazo e a MESMA versão que o cliente viu
      this.assertAnswerable(quote);
      if (input.contentHash !== quote.contentHash) {
        throw conflict('Este orçamento foi atualizado pela oficina. Recarregue a página para ver a versão nova.');
      }

      const items = await repo.listQuoteItems(tx, quote.id);
      const approved = items.filter((item) => input.approvedItemIds.includes(item.id));
      const faltando = items.filter((item) => !item.isOptional && !input.approvedItemIds.includes(item.id));
      if (faltando.length) {
        throw validationFailed([
          { path: 'body.approvedItemIds', message: 'Os itens necessários não podem ser desmarcados' },
        ]);
      }
      if (!approved.length) {
        throw validationFailed([{ path: 'body.approvedItemIds', message: 'Escolha pelo menos um item' }]);
      }

      await this.settle(tx, organizationId, quote, {
        decision: approved.length === items.length ? 'APPROVED' : 'PARTIALLY_APPROVED',
        channel: 'PUBLIC_LINK',
        approvedQuoteItemIds: approved.map((item) => item.id),
        signerName: input.signerName.trim(),
        rejectionReason: null,
        contentHash: input.contentHash,
        recordedByUserId: null,
        actorUserId: null,
        client,
      });
      return this.toPublicDto(tx, await this.reload(tx, quote.id));
    });
  }

  /** Recusa pelo link: nada é reservado, e a OS volta para revisão do orçamento. */
  async publicReject(token: string, input: { reason: string; contentHash: string }, client: ClientInfo): Promise<PublicQuote> {
    const { organizationId, id } = await this.resolveToken(token);

    return withTenant(this.deps.db, { organizationId }, async (tx) => {
      const quote = await repo.lockQuote(tx, id);
      if (!quote) throw notFound('Orçamento não encontrado.');
      if (await repo.findApproval(tx, quote.id)) return this.toPublicDto(tx, await this.reload(tx, quote.id));

      this.assertAnswerable(quote);
      if (input.contentHash !== quote.contentHash) {
        throw conflict('Este orçamento foi atualizado pela oficina. Recarregue a página para ver a versão nova.');
      }

      await this.settle(tx, organizationId, quote, {
        decision: 'REJECTED',
        channel: 'PUBLIC_LINK',
        approvedQuoteItemIds: [],
        signerName: 'Cliente',
        rejectionReason: blankToNull(input.reason) ?? null,
        contentHash: input.contentHash,
        recordedByUserId: null,
        actorUserId: null,
        client,
      });
      return this.toPublicDto(tx, await this.reload(tx, quote.id));
    });
  }

  /** "Fazer pergunta": vira evento na timeline e aviso na oficina, sem chat (MVP 2). */
  async publicQuestion(token: string, message: string): Promise<void> {
    const { organizationId, id } = await this.resolveToken(token);

    await withTenant(this.deps.db, { organizationId }, async (tx) => {
      const found = await repo.findQuote(tx, organizationId, id);
      if (!found) throw notFound('Orçamento não encontrado.');

      await workOrderRepo.insertEvent(tx, {
        organizationId: found.quote.organizationId,
        workOrderId: found.quote.workOrderId,
        type: 'CUSTOMER_QUESTION',
        data: { quoteNumber: found.quote.number, message },
        actorType: 'CUSTOMER',
      });
      await repo.insertMessage(tx, {
        organizationId: found.quote.organizationId,
        customerId: found.customerId,
        channel: 'PUBLIC_PAGE',
        direction: 'INBOUND',
        body: message,
        workOrderId: found.quote.workOrderId,
        quoteId: found.quote.id,
        status: 'RECEIVED',
      });
      await this.notify(tx, found, 'QUOTE_QUESTION', 'Pergunta do cliente', `${found.customerName}: "${message.slice(0, 120)}"`);
    });
  }

  // ------------------------------------------------------------- internos

  /**
   * A transação da decisão (ARCHITECTURE §8.1, passos 3 a 7), na ordem:
   * grava a prova → itens viram APPROVED/REJECTED → a OS muda de status com o
   * total recalculado → reserva o estoque do que foi aprovado → timeline,
   * auditoria e aviso para a equipe.
   */
  private async settle(
    tx: Tx,
    organizationId: string,
    quote: repo.QuoteRow,
    decision: {
      decision: 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED';
      channel: 'PUBLIC_LINK' | 'PHONE' | 'IN_PERSON' | 'WHATSAPP';
      approvedQuoteItemIds: string[];
      signerName: string | null;
      rejectionReason: string | null;
      contentHash: string;
      recordedByUserId: string | null;
      actorUserId: string | null;
      client: ClientInfo;
    },
  ): Promise<Quote> {
    const items = await repo.listQuoteItems(tx, quote.id);
    const aprovados = items.filter((item) => decision.approvedQuoteItemIds.includes(item.id));
    const recusados = items.filter((item) => !decision.approvedQuoteItemIds.includes(item.id));

    // o total aprovado sai do MESMO cálculo da OS (desconto em valor é rateado)
    const order = await workOrderRepo.lockWorkOrder(tx, organizationId, quote.workOrderId);
    if (!order) throw notFound('OS não encontrada.');
    const approvedTotals = computeApprovedTotals(
      items.map((item) => ({
        type: item.type,
        quantityMilli: milli(item.quantity),
        unitPriceCents: item.unitPriceCents,
        discountCents: item.discountCents,
        isOptional: item.isOptional,
        approved: decision.approvedQuoteItemIds.includes(item.id),
      })),
      { discountMode: order.discountMode, discountValue: order.discountValue, surchargeCents: order.surchargeCents },
    );

    // 3) a prova: imutável, uma por orçamento (o UNIQUE impede aprovação dupla)
    await repo.insertApproval(tx, {
      organizationId,
      quoteId: quote.id,
      decision: decision.decision,
      channel: decision.channel,
      approvedQuoteItemIds: decision.approvedQuoteItemIds,
      approvedTotalCents: approvedTotals.totalCents,
      signerName: decision.signerName,
      rejectionReason: decision.rejectionReason,
      ip: decision.channel === 'PUBLIC_LINK' ? decision.client.ip : null,
      userAgent: decision.channel === 'PUBLIC_LINK' ? decision.client.userAgent : null,
      contentHash: decision.contentHash,
      recordedByUserId: decision.recordedByUserId,
    });

    const status = decision.decision === 'REJECTED' ? 'REJECTED' : decision.decision;
    await repo.updateQuote(tx, quote.id, { status, decidedAt: new Date() });

    // 4) itens do orçamento → itens da OS
    await repo.setItemsApprovalStatus(tx, organizationId, aprovados.map((item) => item.workOrderItemId), 'APPROVED');
    await repo.setItemsApprovalStatus(tx, organizationId, recusados.map((item) => item.workOrderItemId), 'REJECTED');

    // 5) a OS: aprovada, ou de volta para revisar o orçamento
    const nextOrderStatus = decision.decision === 'REJECTED' ? 'AWAITING_QUOTE' : 'APPROVED';
    await applyWorkOrderChange(tx, order, {
      status: nextOrderStatus,
      approvedAt: decision.decision === 'REJECTED' ? order.approvedAt : new Date(),
    });

    // 6) estoque: reserva o aprovado. O recusado só teria reserva se já tivesse
    // sido aprovado antes, e hoje nenhum fluxo re-orça item aprovado — o envio
    // congela só rascunho. Então a liberação abaixo é defesa, não caminho vivo:
    // teste de mutação não consegue exercê-la. Fica para quando houver re-orçamento.
    const reserva = await reserveApprovedItems(tx, organizationId, aprovados.map((item) => item.workOrderItemId));
    if (recusados.length) {
      await releaseReservations(tx, organizationId, recusados.map((item) => item.workOrderItemId));
    }

    // 7) timeline, auditoria e aviso
    await workOrderRepo.insertEvent(tx, {
      organizationId,
      workOrderId: quote.workOrderId,
      type: decision.decision === 'REJECTED' ? 'QUOTE_REJECTED' : 'QUOTE_APPROVED',
      data: {
        quoteNumber: quote.number,
        decision: decision.decision,
        approvedTotalCents: approvedTotals.totalCents,
        channel: decision.channel,
        signerName: decision.signerName,
        itemsFaltando: reserva.partial.length,
      },
      actorType: decision.channel === 'PUBLIC_LINK' ? 'CUSTOMER' : 'USER',
      actorUserId: decision.actorUserId,
    });
    await recordActivity(tx, {
      organizationId,
      actorUserId: decision.actorUserId,
      action: `quote.${decision.decision.toLowerCase()}`,
      entityType: 'quote',
      entityId: quote.id,
      metadata: {
        number: quote.number,
        channel: decision.channel,
        approvedTotalCents: approvedTotals.totalCents,
        signerName: decision.signerName,
      },
      ...decision.client,
    });

    const header = await this.reload(tx, quote.id);
    const tipo =
      decision.decision === 'REJECTED'
        ? 'QUOTE_REJECTED'
        : decision.decision === 'APPROVED'
          ? 'QUOTE_APPROVED'
          : 'QUOTE_PARTIALLY_APPROVED';
    await this.notify(
      tx,
      header,
      tipo,
      `Orçamento ${quote.number}: ${decision.decision === 'REJECTED' ? 'recusado' : 'aprovado'}`,
      `${header.customerName} · ${(approvedTotals.totalCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    );

    return this.load(tx, organizationId, quote.id);
  }

  /** Um aviso por pessoa da equipe que cuida de orçamento (dono, admin, gerente, atendente). */
  private async notify(
    tx: Tx,
    header: repo.QuoteHeader,
    type: 'QUOTE_VIEWED' | 'QUOTE_APPROVED' | 'QUOTE_PARTIALLY_APPROVED' | 'QUOTE_REJECTED' | 'QUOTE_QUESTION',
    title: string,
    body: string,
  ): Promise<void> {
    const equipe = await repo.quoteWatchers(tx, header.quote.organizationId);
    await repo.insertNotifications(
      tx,
      equipe
        .filter((member) => can(member.role, 'quotes:send'))
        .map((member) => ({
          organizationId: header.quote.organizationId,
          userId: member.userId,
          type,
          title,
          body,
          link: `/ordens/${header.workOrderNumber}`,
          workOrderId: header.quote.workOrderId,
          quoteId: header.quote.id,
        })),
    );
  }

  private async reload(tx: Tx, id: string): Promise<repo.QuoteHeader> {
    const [row] = await tx
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.id, id))
      .limit(1);
    if (!row) throw notFound('Orçamento não encontrado.');
    const found = await repo.findQuote(tx, row.organizationId, id);
    if (!found) throw notFound('Orçamento não encontrado.');
    return found;
  }

  /** O que o CLIENTE vê: sem CPF, sem endereço, sem custo e sem margem (§8.2). */
  private async toPublicDto(tx: Tx, found: repo.QuoteHeader): Promise<PublicQuote> {
    const items = await repo.listQuoteItems(tx, found.quote.id);
    const photos = await repo.listQuotePhotos(tx, found.quote.id);
    const approval = await repo.findApproval(tx, found.quote.id);

    const photosByItem = new Map<string, { id: string; url: string; caption: string | null }[]>();
    for (const photo of photos) {
      const key = photo.quoteItemId ?? 'sem-item';
      const list = photosByItem.get(key) ?? [];
      list.push({ id: photo.id, url: this.deps.storage.signDownload(photo.storageKey).url, caption: photo.caption });
      photosByItem.set(key, list);
    }

    const snapshot = found.quote.snapshot;
    return {
      number: found.quote.number,
      kind: found.quote.kind,
      status: effectiveQuoteStatus(found.quote.status, found.quote.validUntil.toISOString()),
      validUntil: found.quote.validUntil.toISOString(),
      message: snapshot.message ?? null,
      contentHash: found.quote.contentHash,
      shop: {
        name: snapshot.shop.name,
        phone: snapshot.shop.phone ?? null,
        whatsapp: snapshot.shop.whatsapp ?? null,
        city: snapshot.shop.city ?? null,
        state: snapshot.shop.state ?? null,
      },
      customerFirstName: snapshot.customer.name.trim().split(/\s+/)[0] ?? snapshot.customer.name,
      vehicle: {
        make: snapshot.vehicle.make,
        model: snapshot.vehicle.model,
        version: snapshot.vehicle.version ?? null,
        plate: snapshot.vehicle.plate ?? null,
        yearLabel: snapshot.vehicle.yearLabel ?? null,
      },
      items: items.map((item) => {
        const { workOrderItemId: _ignored, ...dto } = this.toItemDto(item, photosByItem.get(item.id) ?? []);
        return dto;
      }),
      subtotalCents: found.quote.subtotalCents,
      discountCents: found.quote.discountCents,
      surchargeCents: found.quote.surchargeCents,
      totalCents: found.quote.totalCents,
      decision: approval
        ? {
            decision: approval.approval.decision,
            approvedItemIds: approval.approval.approvedQuoteItemIds,
            approvedTotalCents: approval.approval.approvedTotalCents,
            signerName: approval.approval.signerName,
            decidedAt: approval.approval.createdAt.toISOString(),
          }
        : null,
    };
  }

  private assertAnswerable(quote: repo.QuoteRow): void {
    if (!isQuoteAnswerable(quote.status, quote.validUntil.toISOString())) {
      const motivo =
        quote.status === 'SENT'
          ? 'Este orçamento venceu. Peça um novo à oficina.'
          : 'Este orçamento já foi respondido ou cancelado.';
      throw conflict(motivo);
    }
  }

  private publicUrl(token: string): string {
    return `${this.deps.env.APP_URL}/orcamento/${token}`;
  }

  private async shopSnapshot(tx: Tx, organizationId: string): Promise<QuoteSnapshot['shop']> {
    const [row] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const address = (row?.address ?? {}) as { city?: string; state?: string };
    return {
      name: row?.name ?? 'Oficina',
      phone: row?.phone ?? null,
      whatsapp: row?.whatsapp ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
    };
  }

  private async load(tx: Tx, organizationId: string, id: string): Promise<Quote> {
    const found = await repo.findQuote(tx, organizationId, id);
    if (!found) throw notFound('Orçamento não encontrado.');
    const items = await repo.listQuoteItems(tx, id);
    const photos = await repo.listQuotePhotos(tx, id);
    const approval = await repo.findApproval(tx, id);

    const photosByItem = new Map<string, { id: string; url: string; caption: string | null }[]>();
    for (const photo of photos) {
      const key = photo.quoteItemId ?? 'sem-item';
      const list = photosByItem.get(key) ?? [];
      list.push({ id: photo.id, url: this.deps.storage.signDownload(photo.storageKey).url, caption: photo.caption });
      photosByItem.set(key, list);
    }

    return {
      id: found.quote.id,
      number: found.quote.number,
      workOrderId: found.quote.workOrderId,
      workOrderNumber: found.workOrderNumber,
      version: found.quote.version,
      kind: found.quote.kind,
      status: effectiveQuoteStatus(found.quote.status, found.quote.validUntil.toISOString()),
      publicUrl: this.publicUrl(found.quote.publicToken),
      validUntil: found.quote.validUntil.toISOString(),
      message: found.quote.snapshot.message ?? null,
      subtotalCents: found.quote.subtotalCents,
      discountCents: found.quote.discountCents,
      surchargeCents: found.quote.surchargeCents,
      totalCents: found.quote.totalCents,
      approvedTotalCents: approval?.approval.approvedTotalCents ?? null,
      sentAt: found.quote.sentAt.toISOString(),
      sentByName: found.sentByName,
      firstViewedAt: isoOrNull(found.quote.firstViewedAt),
      lastViewedAt: isoOrNull(found.quote.lastViewedAt),
      viewCount: found.quote.viewCount,
      decidedAt: isoOrNull(found.quote.decidedAt),
      decision: approval
        ? {
            decision: approval.approval.decision,
            channel: approval.approval.channel,
            signerName: approval.approval.signerName,
            rejectionReason: approval.approval.rejectionReason,
            approvedItemIds: approval.approval.approvedQuoteItemIds,
            recordedByName: approval.recordedByName,
            decidedAt: approval.approval.createdAt.toISOString(),
          }
        : null,
      items: items.map((item) => this.toItemDto(item, photosByItem.get(item.id) ?? [])),
    };
  }

  private toItemDto(item: repo.QuoteItemRow, photos: { id: string; url: string; caption: string | null }[]): QuoteItem {
    return {
      id: item.id,
      workOrderItemId: item.workOrderItemId,
      type: item.type,
      description: item.description,
      partCode: item.partCode,
      brand: item.brand,
      quantity: milliToNumber(milli(item.quantity)),
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
      totalCents: item.totalCents,
      isOptional: item.isOptional,
      position: item.position,
      photos,
    };
  }
}
