import { v7 as uuidv7 } from 'uuid';
import {
  can,
  canonicalSupplierQuotePayload,
  compareOffers,
  ErrorCode,
  formatWhen,
  isSupplierQuoteAnswerable,
  isSupplierQuoteExpired,
  isValidOffer,
  latestVersions,
  milliToNumber,
  parseQuantity,
  summarizeSuppliers,
  vehicleForSupplier,
  whatsappLink,
  whatsappSupplierQuoteMessage,
  type AwardSupplierQuoteInput,
  type CancelSupplierQuoteInput,
  type CreatedSupplierQuote,
  type CreateSupplierQuoteInput,
  type IssuedSupplierLink,
  type PublicSupplierQuote,
  type PublicSupplierResponseInput,
  type SupplierQuote,
  type SupplierQuoteListItem,
  type SupplierResponseVersion,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { nextNumber } from '../../core/counters';
import { AppError, notFound, validationFailed } from '../../core/errors';
import { blankToNull, isoOrNull } from '../../core/normalize';
import { readOrganizationSettings, readTimezone } from '../../core/org-settings';
import type { Tx } from '../../db/tenant';
import { withSupplierToken, withTenant } from '../../db/tenant';
import { randomToken, sha256 } from '../auth/tokens';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import * as purchaseRepo from '../purchases/purchases.repository';
import * as repo from './supplier-quotes.repository';

export const COUNTER_SUPPLIER_QUOTE = 'supplier_quote';

const milli = (valor: string) => parseQuantity(valor) ?? 0;

/** Preço de fornecedor é CUSTO: quem não vê custo não vê preço (decisão de 14/09/2026). */
const veCusto = (auth: AuthContext) => can(auth.role, 'parts:view_cost');

const indisponivel = (titulo: string, detalhe: string) =>
  new AppError(422, ErrorCode.INVALID_TRANSITION, titulo, detalhe);

/**
 * Cotação com fornecedores por link (MVP 2, E11) — o lado da oficina.
 *
 * O que este serviço garante, e os testes provam:
 * - o conteúdo que o fornecedor vê sai do BANCO (itens da OS, carro filtrado),
 *   nunca do corpo da requisição;
 * - o link sai em texto uma vez e o banco guarda só o hash;
 * - quem não vê custo não recebe preço, frete, total nem "mais barato";
 * - a escolha só aceita a ÚLTIMA versão de cada fornecedor, e da mesma peça;
 * - o custo só entra no item da OS que ainda é rascunho.
 */
export class SupplierQuotesService {
  constructor(private readonly deps: ServiceDeps) {}

  // ================================ criar ====================================

  async create(auth: AuthContext, input: CreateSupplierQuoteInput, client: ClientInfo): Promise<CreatedSupplierQuote> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const os = await repo.findWorkOrderWithVehicle(tx, org, input.workOrderId);
      if (!os) throw notFound('OS não encontrada.');
      if (os.order.status === 'DELIVERED' || os.order.status === 'CANCELED') {
        throw indisponivel('OS encerrada', 'Não dá para pedir cotação para uma OS entregue ou cancelada.');
      }

      // as peças: da PRÓPRIA OS, e só peça (serviço não se cota com fornecedor)
      const linhas = await repo.listWorkOrderItemsById(tx, org, os.order.id, input.workOrderItemIds);
      const porId = new Map(linhas.map((linha) => [linha.item.id, linha]));
      const faltando = input.workOrderItemIds.filter((itemId) => !porId.has(itemId));
      if (faltando.length) {
        throw validationFailed([{ path: 'body.workOrderItemIds', message: 'Peça não encontrada nesta OS' }]);
      }
      if (linhas.some((linha) => linha.item.type !== 'PART')) {
        throw validationFailed([{ path: 'body.workOrderItemIds', message: 'Só peças entram na cotação' }]);
      }

      // os fornecedores: desta oficina e ainda na lista
      const fornecedores = await repo.listActiveSuppliersById(tx, org, input.supplierIds);
      if (fornecedores.length !== input.supplierIds.length) {
        throw validationFailed([{ path: 'body.supplierIds', message: 'Fornecedor não encontrado' }]);
      }

      // o carro COMO O FORNECEDOR VÊ: sem placa nunca, chassi só com a marcação
      const vehicle = vehicleForSupplier(os.vehicle, input.includeVin);
      const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);
      const message = blankToNull(input.message) ?? null;

      // ids gerados antes de gravar: o hash cobre o id de cada item
      const itens = input.workOrderItemIds.map((itemId, indice) => {
        const { item, unit } = porId.get(itemId)!;
        return {
          id: uuidv7(),
          organizationId: org,
          workOrderItemId: item.id,
          partId: item.partId,
          description: item.description,
          partCode: item.partCode,
          brand: item.brand,
          quantity: item.quantity,
          unit: unit ?? 'UN',
          position: indice + 1,
        };
      });
      const contentHash = sha256(
        canonicalSupplierQuotePayload({
          items: itens.map((item) => ({
            id: item.id,
            description: item.description,
            partCode: item.partCode,
            brand: item.brand,
            quantityMilli: milli(item.quantity),
            unit: item.unit,
          })),
          vehicle,
          message,
          expiresAt: expiresAt.toISOString(),
        }),
      );

      const number = await nextNumber(tx, org, COUNTER_SUPPLIER_QUOTE);
      const cotacao = await repo.insertRequest(tx, {
        organizationId: org,
        number,
        workOrderId: os.order.id,
        vehicle,
        includeVin: input.includeVin,
        message,
        contentHash,
        expiresAt,
        createdBy: auth.userId,
      });
      await repo.insertRequestItems(
        tx,
        itens.map((item) => ({ ...item, requestId: cotacao.id })),
      );

      const oficina = await workOrderRepo.findOrganization(tx, org);
      const timezone = await readTimezone(tx, org);
      const links: IssuedSupplierLink[] = [];
      for (const fornecedor of fornecedores) {
        const token = randomToken();
        const convite = await repo.insertInvite(tx, {
          organizationId: org,
          requestId: cotacao.id,
          supplierId: fornecedor.id,
          tokenHash: sha256(token),
        });
        links.push(
          this.montarLink(convite.id, fornecedor, token, {
            shopName: oficina?.name ?? 'Oficina',
            number,
            itemCount: itens.length,
            expiresAt: formatWhen(expiresAt, timezone),
          }),
        );
      }

      await workOrderRepo.insertEvent(tx, {
        organizationId: org,
        workOrderId: os.order.id,
        type: 'SUPPLIER_QUOTE_SENT',
        data: {
          text: `Cotação nº ${number} enviada para ${fornecedores.length} ${fornecedores.length === 1 ? 'fornecedor' : 'fornecedores'} (${itens.length} ${itens.length === 1 ? 'peça' : 'peças'}).`,
          number,
        },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'supplier_quote.created',
        entityType: 'supplier_quote',
        entityId: cotacao.id,
        workOrderId: os.order.id,
        metadata: { number, suppliers: fornecedores.length, items: itens.length, includeVin: input.includeVin },
        ...client,
      });

      return { quote: await this.carregar(tx, auth, cotacao.id), links };
    });
  }

  // ================================ ler ======================================

  async get(auth: AuthContext, id: string): Promise<SupplierQuote> {
    return withTenant(this.deps.db, auth, (tx) => this.carregar(tx, auth, id));
  }

  async listForWorkOrder(auth: AuthContext, workOrderId: string): Promise<{ data: SupplierQuoteListItem[] }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const agora = new Date();
      const linhas = await repo.listRequestsForWorkOrder(tx, auth.organizationId, workOrderId);
      return {
        data: linhas.map(({ request, itemCount, supplierCount, answeredCount }) => ({
          id: request.id,
          number: request.number,
          status: request.status,
          expired: isSupplierQuoteExpired(request, agora),
          expiresAt: request.expiresAt.toISOString(),
          createdAt: request.createdAt.toISOString(),
          itemCount,
          supplierCount,
          answeredCount,
        })),
      };
    });
  }

  // ============================== reenviar ===================================

  /**
   * Link novo para um fornecedor. O anterior MORRE na hora (o hash é trocado):
   * é assim que "mandei para o número errado" se resolve sem deixar um link vivo
   * na mão de quem não devia.
   */
  async reissueLink(auth: AuthContext, id: string, inviteId: string, client: ClientInfo): Promise<IssuedSupplierLink> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const cotacao = await repo.lockRequest(tx, org, id);
      if (!cotacao) throw notFound('Cotação não encontrada.');
      if (!isSupplierQuoteAnswerable(cotacao)) {
        throw indisponivel('Cotação fechada', 'Só dá para reenviar link de cotação aberta e dentro do prazo.');
      }
      const convite = await repo.findInvite(tx, org, inviteId);
      if (!convite || convite.requestId !== cotacao.id) throw notFound('Fornecedor não está nesta cotação.');
      const [fornecedor] = await repo.listActiveSuppliersById(tx, org, [convite.supplierId]);
      if (!fornecedor) throw indisponivel('Fornecedor fora da lista', 'Este fornecedor foi tirado da lista.');

      const token = randomToken();
      await repo.updateInvite(tx, convite.id, { tokenHash: sha256(token), linkIssuedAt: new Date() });

      const oficina = await workOrderRepo.findOrganization(tx, org);
      const timezone = await readTimezone(tx, org);
      const itens = await repo.listRequestItems(tx, org, cotacao.id);
      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'supplier_quote.link_reissued',
        entityType: 'supplier_quote',
        entityId: cotacao.id,
        workOrderId: cotacao.workOrderId,
        metadata: { number: cotacao.number, supplierId: fornecedor.id },
        ...client,
      });
      return this.montarLink(convite.id, fornecedor, token, {
        shopName: oficina?.name ?? 'Oficina',
        number: cotacao.number,
        itemCount: itens.length,
        expiresAt: formatWhen(cotacao.expiresAt, timezone),
      });
    });
  }

  // ============================== cancelar ===================================

  async cancel(auth: AuthContext, id: string, input: CancelSupplierQuoteInput, client: ClientInfo): Promise<SupplierQuote> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const cotacao = await repo.lockRequest(tx, auth.organizationId, id);
      if (!cotacao) throw notFound('Cotação não encontrada.');
      if (cotacao.status === 'CANCELED') {
        throw indisponivel('Cotação já cancelada', 'Esta cotação já estava cancelada.');
      }
      const motivo = input.reason.trim();
      await repo.updateRequest(tx, cotacao.id, { status: 'CANCELED', canceledAt: new Date(), cancelReason: motivo });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'supplier_quote.canceled',
        entityType: 'supplier_quote',
        entityId: cotacao.id,
        workOrderId: cotacao.workOrderId,
        metadata: { number: cotacao.number, reason: motivo },
        ...client,
      });
      return this.carregar(tx, auth, cotacao.id);
    });
  }

  // =============================== escolher ==================================

  /**
   * A oferta vencedora, por peça. A primeira escolha ENCERRA a cotação: o
   * fornecedor não reenvia mais (decisão de 14/09/2026), e o preço de cada um
   * vai para o histórico da peça. Trocar a escolha depois continua valendo.
   */
  async award(auth: AuthContext, id: string, input: AwardSupplierQuoteInput, client: ClientInfo): Promise<SupplierQuote> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const org = auth.organizationId;
      const cotacao = await repo.lockRequest(tx, org, id);
      if (!cotacao) throw notFound('Cotação não encontrada.');
      if (cotacao.status === 'CANCELED') {
        throw indisponivel('Cotação cancelada', 'Não dá para escolher oferta de uma cotação cancelada.');
      }

      const itens = await repo.listRequestItems(tx, org, cotacao.id);
      const itemPorId = new Map(itens.map((item) => [item.id, item]));
      const respostas = await repo.listResponses(tx, org, cotacao.id);
      // só a ÚLTIMA versão de cada fornecedor vale: escolher a versão antiga seria
      // comprar pelo preço que ele mesmo corrigiu
      const ultimas = latestVersions(respostas.map((r) => ({ ...r, inviteId: r.response.inviteId, version: r.response.version })));
      const ofertaValida = new Map<string, { requestItemId: string; unitPriceCents: number; supplierId: string }>();
      for (const resposta of ultimas) {
        for (const linha of resposta.items) {
          const oferta = {
            responseItemId: linha.id,
            requestItemId: linha.requestItemId,
            supplierId: resposta.supplierId,
            availability: linha.availability,
            unitPriceCents: linha.unitPriceCents,
            leadTimeDays: linha.leadTimeDays,
          };
          if (isValidOffer(oferta)) {
            ofertaValida.set(linha.id, {
              requestItemId: linha.requestItemId,
              unitPriceCents: linha.unitPriceCents!,
              supplierId: resposta.supplierId,
            });
          }
        }
      }

      for (const [indice, escolha] of input.awards.entries()) {
        if (!itemPorId.has(escolha.requestItemId)) {
          throw validationFailed([{ path: `body.awards.${indice}.requestItemId`, message: 'Peça não está nesta cotação' }]);
        }
        const oferta = ofertaValida.get(escolha.responseItemId);
        // a oferta tem de existir na última versão, ser válida E ser da MESMA peça
        if (!oferta || oferta.requestItemId !== escolha.requestItemId) {
          throw validationFailed([{ path: `body.awards.${indice}.responseItemId`, message: 'Oferta inválida para esta peça' }]);
        }
      }

      // trocar a escolha que já virou pedido de compra compraria duas vezes: a
      // compra (E12) é que torna a escolha definitiva
      const vigentes = await repo.listAwards(tx, org, cotacao.id);
      const trocadas = vigentes.filter(({ award }) =>
        input.awards.some((e) => e.requestItemId === award.requestItemId && e.responseItemId !== award.responseItemId),
      );
      const [pedida] = await purchaseRepo.listActiveLines(tx, org, { awardIds: trocadas.map(({ award }) => award.id) });
      if (pedida) {
        const item = itemPorId.get(trocadas.find(({ award }) => award.id === pedida.awardId)!.award.requestItemId)!;
        throw new AppError(
          422,
          ErrorCode.SUPPLIER_QUOTE_ORDERED,
          'Escolha já virou pedido',
          `A escolha de ${item.description} já está no pedido de compra nº ${pedida.orderNumber}. Cancele o pedido para trocar.`,
        );
      }

      const custoAplicado: string[] = [];
      const custoMantido: string[] = [];
      for (const escolha of input.awards) {
        await repo.upsertAward(tx, {
          organizationId: org,
          requestItemId: escolha.requestItemId,
          responseItemId: escolha.responseItemId,
          awardedBy: auth.userId,
        });
        // custo na OS só se o item ainda é rascunho (decisão de 14/09/2026): o que
        // já foi ao cliente não se mexe — mexer substituiria o orçamento (E6)
        const item = itemPorId.get(escolha.requestItemId)!;
        if (!item.workOrderItemId) continue;
        const [linhaOs] = await repo.listWorkOrderItemsById(tx, org, cotacao.workOrderId!, [item.workOrderItemId]);
        if (linhaOs?.item.approvalStatus === 'DRAFT') {
          await repo.updateWorkOrderItemCost(tx, org, item.workOrderItemId, ofertaValida.get(escolha.responseItemId)!.unitPriceCents);
          custoAplicado.push(item.description);
        } else if (linhaOs) {
          custoMantido.push(item.description);
        }
      }

      const encerrou = cotacao.status === 'OPEN';
      if (encerrou) {
        await repo.updateRequest(tx, cotacao.id, { status: 'CLOSED', closedAt: new Date() });
        // o mercado no momento da decisão: todo preço válido, de todo fornecedor
        await repo.insertPriceHistory(
          tx,
          [...ofertaValida.values()].flatMap((oferta) => {
            const partId = itemPorId.get(oferta.requestItemId)?.partId;
            return partId
              ? [{
                  organizationId: org,
                  partId,
                  supplierId: oferta.supplierId,
                  priceCents: oferta.unitPriceCents,
                  source: 'RFQ' as const,
                  supplierQuoteRequestId: cotacao.id,
                }]
              : [];
          }),
        );
      }

      if (cotacao.workOrderId) {
        const partes = [`Cotação nº ${cotacao.number}: escolhida a oferta de ${input.awards.length} ${input.awards.length === 1 ? 'peça' : 'peças'}.`];
        if (custoMantido.length) partes.push(`Custo não alterado em ${custoMantido.join(', ')} (já foi no orçamento).`);
        await workOrderRepo.insertEvent(tx, {
          organizationId: org,
          workOrderId: cotacao.workOrderId,
          type: 'NOTE',
          data: { text: partes.join(' ') },
          actorUserId: auth.userId,
        });
      }
      await recordActivity(tx, {
        organizationId: org,
        actorUserId: auth.userId,
        action: 'supplier_quote.awarded',
        entityType: 'supplier_quote',
        entityId: cotacao.id,
        workOrderId: cotacao.workOrderId,
        metadata: { number: cotacao.number, awards: input.awards, closed: encerrou, custoAplicado, custoMantido },
        ...client,
      });
      return this.carregar(tx, auth, cotacao.id);
    });
  }

  // ============================ lado público ================================

  /**
   * A fase do token: devolve SÓ a oficina e o convite. O token nunca vai ao banco
   * em texto — vai o hash, e a policy libera a linha daquele convite e nenhuma
   * outra. Link torto nem chega a consultar.
   */
  private async resolverLink(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw notFound('Link de cotação inválido.');
    const hash = sha256(token);
    const convite = await withSupplierToken(this.deps.db, hash, (tx) => repo.resolveInviteByHash(tx, hash));
    if (!convite) throw notFound('Link de cotação inválido ou substituído por um mais novo.');
    return convite;
  }

  /** O fornecedor abre o link: vê as peças, o carro filtrado e a própria resposta anterior. */
  async publicView(token: string): Promise<PublicSupplierQuote> {
    const convite = await this.resolverLink(token);
    return withTenant(this.deps.db, { organizationId: convite.organizationId }, async (tx) => {
      const tela = await this.telaDoFornecedor(tx, convite);
      const agora = new Date();
      const atual = await repo.findInvite(tx, convite.organizationId, convite.id);
      if (atual) {
        await repo.updateInvite(tx, convite.id, {
          firstViewedAt: atual.firstViewedAt ?? agora,
          lastViewedAt: agora,
          viewCount: atual.viewCount + 1,
        });
      }
      return tela;
    });
  }

  /**
   * A resposta: cada envio é uma VERSÃO nova e imutável. Trava a cotação antes
   * de validar — a escolha da oficina e a correção do fornecedor não podem se
   * cruzar, e o número da versão não pode repetir.
   */
  async publicRespond(token: string, input: PublicSupplierResponseInput, client: ClientInfo): Promise<PublicSupplierQuote> {
    const convite = await this.resolverLink(token);
    const org = convite.organizationId;
    return withTenant(this.deps.db, { organizationId: org }, async (tx) => {
      const cotacao = await repo.lockRequest(tx, org, convite.requestId);
      if (!cotacao) throw notFound('Cotação não encontrada.');
      const fornecedor = await repo.findSupplierAnyState(tx, org, convite.supplierId);
      // fornecedor tirado da lista: o link morre junto (lição do b9d1a36)
      if (!fornecedor || fornecedor.deletedAt) throw notFound('Este link não está mais ativo.');

      if (!isSupplierQuoteAnswerable(cotacao)) {
        const motivo =
          cotacao.status === 'CANCELED'
            ? 'A oficina cancelou esta cotação.'
            : cotacao.status === 'CLOSED'
              ? 'A oficina já escolheu as ofertas desta cotação.'
              : 'O prazo para responder esta cotação acabou.';
        throw new AppError(422, ErrorCode.SUPPLIER_QUOTE_CLOSED, 'Cotação encerrada', motivo);
      }
      if (input.contentHash !== cotacao.contentHash) {
        throw new AppError(
          409,
          ErrorCode.SUPPLIER_QUOTE_OUTDATED,
          'Cotação diferente',
          'O que você respondeu não é a versão atual desta cotação. Recarregue a página.',
        );
      }

      // toda peça pedida respondida, exatamente uma vez, e nenhuma peça a mais
      const itens = await repo.listRequestItems(tx, org, cotacao.id);
      const pedidos = new Set(itens.map((item) => item.id));
      const respondidos = new Set(input.items.map((item) => item.requestItemId));
      const faltou = [...pedidos].some((itemId) => !respondidos.has(itemId));
      const sobrou = [...respondidos].some((itemId) => !pedidos.has(itemId));
      if (faltou || sobrou) {
        throw validationFailed([
          {
            path: 'body.items',
            message: faltou
              ? 'Responda todas as peças (use "não tenho" quando for o caso)'
              : 'Peça que não está nesta cotação',
          },
        ]);
      }

      const anteriores = await repo.listResponsesOfInvite(tx, org, convite.id);
      const version = (anteriores.at(-1)?.response.version ?? 0) + 1;
      const resposta = await repo.insertResponse(tx, {
        organizationId: org,
        inviteId: convite.id,
        version,
        responderName: input.responderName.trim(),
        shippingCents: input.shippingCents,
        notes: blankToNull(input.notes) ?? null,
        contentHash: input.contentHash,
        ip: client.ip,
        userAgent: client.userAgent,
      });
      await repo.insertResponseItems(
        tx,
        input.items.map((item) => ({
          organizationId: org,
          responseId: resposta.id,
          requestItemId: item.requestItemId,
          availability: item.availability,
          unitPriceCents: item.availability === 'UNAVAILABLE' ? null : item.unitPriceCents,
          brand: blankToNull(item.brand) ?? null,
          leadTimeDays: item.leadTimeDays,
          notes: blankToNull(item.notes) ?? null,
        })),
      );

      const texto =
        version === 1
          ? `${fornecedor.name} respondeu a cotação nº ${cotacao.number}.`
          : `${fornecedor.name} corrigiu a resposta da cotação nº ${cotacao.number} (versão ${version}).`;
      if (cotacao.workOrderId) {
        await workOrderRepo.insertEvent(tx, {
          organizationId: org,
          workOrderId: cotacao.workOrderId,
          type: 'SUPPLIER_QUOTE_ANSWERED',
          // sem preço na timeline: quem lê a OS pode não ter permissão de ver custo
          data: { text: texto, number: cotacao.number, version },
          actorType: 'SYSTEM',
        });
        const os = await workOrderRepo.findWorkOrder(tx, org, { id: cotacao.workOrderId });
        const equipe = await repo.teamMembers(tx, org);
        await repo.insertNotifications(
          tx,
          equipe
            .filter((membro) => can(membro.role, 'supplier_quotes:send'))
            .map((membro) => ({
              organizationId: org,
              userId: membro.userId,
              type: 'SUPPLIER_QUOTE_ANSWERED' as const,
              title: version === 1 ? 'Fornecedor respondeu a cotação' : 'Fornecedor corrigiu a cotação',
              body: texto,
              link: os ? `/ordens/${os.order.number}` : null,
              workOrderId: cotacao.workOrderId,
            })),
        );
      }
      await recordActivity(tx, {
        organizationId: org,
        actorType: 'SYSTEM',
        action: 'supplier_quote.answered',
        entityType: 'supplier_quote',
        entityId: cotacao.id,
        workOrderId: cotacao.workOrderId,
        metadata: { number: cotacao.number, supplierId: fornecedor.id, version, responderName: input.responderName.trim() },
        ...client,
      });

      return this.telaDoFornecedor(tx, convite);
    });
  }

  /**
   * O que a página do fornecedor recebe. Montada campo a campo: nada da OS, do
   * cliente ou dos outros fornecedores entra aqui — e o veículo já está gravado
   * filtrado (sem placa; chassi só com a marcação).
   */
  private async telaDoFornecedor(
    tx: Tx,
    convite: { id: string; organizationId: string; requestId: string; supplierId: string },
  ): Promise<PublicSupplierQuote> {
    const org = convite.organizationId;
    const found = await repo.findRequest(tx, org, convite.requestId);
    if (!found) throw notFound('Cotação não encontrada.');
    const fornecedor = await repo.findSupplierAnyState(tx, org, convite.supplierId);
    if (!fornecedor || fornecedor.deletedAt) throw notFound('Este link não está mais ativo.');
    const { request } = found;
    const agora = new Date();
    const itens = await repo.listRequestItems(tx, org, request.id);
    const minhas = await repo.listResponsesOfInvite(tx, org, convite.id);
    const ultima = minhas.at(-1);
    const oficina = await workOrderRepo.findOrganization(tx, org);

    const state =
      request.status === 'OPEN' ? (isSupplierQuoteExpired(request, agora) ? 'EXPIRED' : 'OPEN') : request.status;
    return {
      shopName: oficina?.name ?? 'Oficina',
      shopPhone: oficina?.whatsapp ?? null,
      number: request.number,
      supplierName: fornecedor.name,
      state,
      answerable: isSupplierQuoteAnswerable(request, agora),
      expiresAt: request.expiresAt.toISOString(),
      vehicle: request.vehicle,
      message: request.message,
      contentHash: request.contentHash,
      items: itens.map((item) => ({
        id: item.id,
        description: item.description,
        partCode: item.partCode,
        brand: item.brand,
        quantity: milliToNumber(milli(item.quantity)),
        unit: item.unit,
      })),
      lastResponse: ultima
        ? {
            version: ultima.response.version,
            responderName: ultima.response.responderName,
            shippingCents: ultima.response.shippingCents,
            notes: ultima.response.notes,
            createdAt: ultima.response.createdAt.toISOString(),
            items: ultima.items.map((linha) => ({
              requestItemId: linha.requestItemId,
              availability: linha.availability,
              unitPriceCents: linha.unitPriceCents,
              brand: linha.brand,
              leadTimeDays: linha.leadTimeDays,
              notes: linha.notes,
            })),
          }
        : null,
    };
  }

  // ================================ apoio ====================================

  private montarLink(
    inviteId: string,
    fornecedor: { id: string; name: string; whatsapp: string | null; contactName: string | null },
    token: string,
    contexto: { shopName: string; number: number; itemCount: number; expiresAt: string },
  ): IssuedSupplierLink {
    const link = `${this.deps.env.APP_URL}/cotacao/${token}`;
    const message = whatsappSupplierQuoteMessage({ ...contexto, contactName: fornecedor.contactName, link });
    return {
      inviteId,
      supplierId: fornecedor.id,
      supplierName: fornecedor.name,
      link,
      message,
      whatsappUrl: fornecedor.whatsapp ? whatsappLink(fornecedor.whatsapp, message) : null,
    };
  }

  /** A cotação montada para a tela da oficina, com os preços escondidos para quem não vê custo. */
  private async carregar(tx: Tx, auth: AuthContext, id: string): Promise<SupplierQuote> {
    const org = auth.organizationId;
    const found = await repo.findRequest(tx, org, id);
    if (!found) throw notFound('Cotação não encontrada.');
    const { request } = found;
    const escondido = !veCusto(auth);
    const agora = new Date();

    const [itens, convites, respostas, escolhas] = [
      await repo.listRequestItems(tx, org, id),
      await repo.listInvites(tx, org, id),
      await repo.listResponses(tx, org, id),
      await repo.listAwards(tx, org, id),
    ];
    // margem e preço de venda são informação de custo: nem se consultam para quem não vê
    const precificacao = new Map((escondido ? [] : await repo.listItemPricing(tx, org, id)).map((linha) => [linha.requestItemId, linha]));
    const margemPadrao = escondido ? 0 : (await readOrganizationSettings(tx, org)).defaultMarkupBps;

    const versoes: SupplierResponseVersion[] = respostas.map(({ response, supplierId, items }) => ({
      inviteId: response.inviteId,
      supplierId,
      version: response.version,
      shippingCents: response.shippingCents,
      items: items.map((linha) => ({
        responseItemId: linha.id,
        requestItemId: linha.requestItemId,
        supplierId,
        availability: linha.availability,
        unitPriceCents: linha.unitPriceCents,
        leadTimeDays: linha.leadTimeDays,
      })),
    }));
    const ultimas = latestVersions(versoes);
    const pedidoDaEscolha = new Map(
      (await purchaseRepo.listActiveLines(tx, org, { awardIds: escolhas.map(({ award }) => award.id) })).map((linha) => [
        linha.awardId,
        { id: linha.orderId, number: linha.orderNumber },
      ]),
    );
    const comparacao = new Map(compareOffers(itens.map((item) => item.id), ultimas).map((c) => [c.requestItemId, c]));
    const supplierDaLinha = new Map(respostas.flatMap(({ supplierId, items }) => items.map((linha) => [linha.id, supplierId] as const)));

    return {
      id: request.id,
      number: request.number,
      status: request.status,
      expired: isSupplierQuoteExpired(request, agora),
      expiresAt: request.expiresAt.toISOString(),
      createdAt: request.createdAt.toISOString(),
      createdByName: found.createdByName,
      closedAt: isoOrNull(request.closedAt),
      canceledAt: isoOrNull(request.canceledAt),
      cancelReason: request.cancelReason,
      workOrder: request.workOrderId && found.workOrderNumber !== null ? { id: request.workOrderId, number: found.workOrderNumber } : null,
      vehicle: request.vehicle,
      includeVin: request.includeVin,
      message: request.message,
      pricesHidden: escondido,
      items: itens.map((item) => {
        const escolha = escolhas.find((e) => e.award.requestItemId === item.id);
        const c = comparacao.get(item.id);
        return {
          id: item.id,
          workOrderItemId: item.workOrderItemId,
          partId: item.partId,
          description: item.description,
          partCode: item.partCode,
          brand: item.brand,
          quantity: milliToNumber(milli(item.quantity)),
          unit: item.unit,
          award: escolha
            ? {
                responseItemId: escolha.award.responseItemId,
                supplierId: supplierDaLinha.get(escolha.award.responseItemId) ?? '',
                awardedAt: escolha.award.awardedAt.toISOString(),
                awardedByName: escolha.awardedByName,
              }
            : null,
          purchaseOrder: escolha ? (pedidoDaEscolha.get(escolha.award.id) ?? null) : null,
          // "o mais barato" já é informação de preço: some junto com o preço
          cheapestResponseItemId: escondido ? null : (c?.cheapest?.responseItemId ?? null),
          fastestResponseItemId: c?.fastest?.responseItemId ?? null,
          pricing: escondido
            ? null
            : {
                markupBps: precificacao.get(item.id)?.partMarkupBps ?? margemPadrao,
                workOrderUnitPriceCents: precificacao.get(item.id)?.workOrderUnitPriceCents ?? null,
                workOrderItemDraft: precificacao.get(item.id)?.approvalStatus === 'DRAFT',
              },
        };
      }),
      invites: convites.map(({ invite, supplier }) => {
        const dele = respostas.filter((r) => r.response.inviteId === invite.id);
        const ultima = dele.at(-1);
        return {
          id: invite.id,
          supplier: { id: supplier.id, name: supplier.name, whatsapp: supplier.whatsapp },
          linkIssuedAt: invite.linkIssuedAt.toISOString(),
          firstViewedAt: isoOrNull(invite.firstViewedAt),
          lastViewedAt: isoOrNull(invite.lastViewedAt),
          viewCount: invite.viewCount,
          versions: dele.length,
          response: ultima
            ? {
                version: ultima.response.version,
                responderName: ultima.response.responderName,
                shippingCents: escondido ? null : ultima.response.shippingCents,
                notes: ultima.response.notes,
                createdAt: ultima.response.createdAt.toISOString(),
                items: ultima.items.map((linha) => ({
                  id: linha.id,
                  requestItemId: linha.requestItemId,
                  availability: linha.availability,
                  unitPriceCents: escondido ? null : linha.unitPriceCents,
                  brand: linha.brand,
                  leadTimeDays: linha.leadTimeDays,
                  notes: linha.notes,
                })),
              }
            : null,
        };
      }),
      summaries: escondido
        ? []
        : summarizeSuppliers(ultimas, new Map(itens.map((item) => [item.id, milli(item.quantity)]))),
    };
  }
}
