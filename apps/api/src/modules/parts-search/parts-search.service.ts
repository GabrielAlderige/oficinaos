import { v7 as uuidv7 } from 'uuid';
import {
  custoTotalCents,
  diferencaParaAMaisBarata,
  ErrorCode,
  ordenarOfertas,
  parseCsv,
  parseCsvMoney,
  PART_SEARCH_PROVIDER_LABELS,
  rankOffers,
  suggestedSalePrice,
  type AddOfferToWorkOrderInput,
  type OfferBadge,
  type PartOffer,
  type PartSearchProviderId,
  type PartSearchQuery,
  type PartSearchResult,
  type PriceList,
  type PriceListImportInput,
  type PriceListImportResult,
  type ProviderStatus,
  type WorkOrder,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { blankToNull } from '../../core/normalize';
import { readOrganizationSettings } from '../../core/org-settings';
import { partSearchProviders } from '../../integrations/parts-search/providers';
import type { PartSearchContext, RawOffer } from '../../integrations/parts-search/types';
import { withTenant } from '../../db/tenant';
import type { WorkOrdersService } from '../work-orders/work-orders.service';
import * as repo from './parts-search.repository';

/** Colunas aceitas no CSV do fornecedor, na ordem de preferência. */
const COLUNAS = {
  code: ['codigo', 'cod', 'referencia', 'ref', 'sku', 'partnumber', 'code'],
  name: ['descricao', 'nome', 'produto', 'peca', 'item', 'name', 'description'],
  brand: ['marca', 'fabricante', 'brand'],
  price: ['preco', 'precounit', 'precounitario', 'valor', 'price', 'unitprice', 'precovenda'],
  unit: ['unidade', 'un', 'unit'],
} as const;

const pegar = (linha: Record<string, string>, chaves: readonly string[]): string =>
  chaves.map((chave) => linha[chave]).find((valor) => valor !== undefined && valor !== '') ?? '';

/**
 * Pesquisa de peças e comparador (E14).
 *
 * A pergunta que a tela responde é a do balcão: **"onde eu arrumo esta peça,
 * por quanto e em quanto tempo?"** As fontes são providers atrás de uma
 * interface só (ARCHITECTURE §12) — estoque próprio, lista de preço importada
 * e cotação respondida. Marketplace entra quando houver API oficial e termos
 * que permitam; scraping, nunca.
 *
 * Toda busca fica gravada com as ofertas e a hora: preço de peça é sempre
 * "consultado às 14:32", e é isso que explica o custo de uma OS meses depois.
 */
export class PartsSearchService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly workOrders: WorkOrdersService,
  ) {}

  async search(auth: AuthContext, input: PartSearchQuery, client: ClientInfo): Promise<PartSearchResult> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const veiculo = input.vehicleId ? await repo.findVehicle(tx, auth.organizationId, input.vehicleId) : null;
      if (input.vehicleId && !veiculo) throw notFound('Veículo não encontrado.');

      const disponiveis = partSearchProviders({ mock: this.deps.env.PARTS_SEARCH_MOCK });
      const escolhidos = input.providers.length
        ? disponiveis.filter((provider) => input.providers.includes(provider.id))
        : disponiveis;

      const consulta = await repo.insertQuery(tx, {
        organizationId: auth.organizationId,
        query: input.q,
        vehicleId: veiculo?.id ?? null,
        providers: escolhidos.map((provider) => provider.id),
        requestedBy: auth.userId,
      });

      const contexto: PartSearchContext = {
        tx,
        organizationId: auth.organizationId,
        vehicle: veiculo ? { id: veiculo.id, make: veiculo.make, model: veiculo.model, yearModel: veiculo.yearModel } : null,
      };

      /**
       * Os providers de hoje leem o banco da própria oficina e dividem UMA
       * conexão (a da transação), então rodam em sequência — Postgres não
       * multiplexa consulta na mesma conexão. Provider externo (marketplace)
       * não usa o `tx`: vai rodar em paralelo, com timeout próprio, quando
       * existir. Um provider que falha não derruba a busca: vira "indisponível".
       */
      const status: ProviderStatus[] = [];
      const brutas: { provider: PartSearchProviderId; isMock: boolean; oferta: RawOffer }[] = [];
      for (const provider of escolhidos) {
        try {
          const ofertas = await provider.search(contexto, input.q);
          brutas.push(...ofertas.map((oferta) => ({ provider: provider.id, isMock: provider.isMock, oferta })));
          status.push({ provider: provider.id, ok: true, count: ofertas.length, message: null, isMock: provider.isMock });
        } catch (erro) {
          this.deps.log.error({ err: erro, provider: provider.id }, 'provider de peças falhou');
          status.push({
            provider: provider.id,
            ok: false,
            count: 0,
            message: `${PART_SEARCH_PROVIDER_LABELS[provider.id]} não respondeu agora.`,
            isMock: provider.isMock,
          });
        }
      }

      const agora = new Date();
      const gravadas = await repo.insertOffers(
        tx,
        brutas.map(({ provider, isMock, oferta }, indice) => ({
          organizationId: auth.organizationId,
          queryId: consulta.id,
          provider,
          isMock,
          supplierId: oferta.supplierId,
          partId: oferta.partId,
          title: oferta.title,
          brand: oferta.brand,
          code: oferta.code,
          priceCents: oferta.priceCents,
          shippingCents: oferta.shippingCents,
          availability: oferta.availability,
          leadTimeDays: oferta.leadTimeDays,
          availableQuantity: oferta.availableQuantity === null ? null : String(oferta.availableQuantity),
          offerUrl: oferta.offerUrl,
          raw: oferta.raw ?? null,
          fetchedAt: agora,
          position: indice,
        })),
      );

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'parts_search.performed',
        entityType: 'part_search_query',
        entityId: consulta.id,
        metadata: { query: input.q, offers: gravadas.length, providers: escolhidos.map((p) => p.id) },
        ...client,
      });

      const markupBps = (await readOrganizationSettings(tx, auth.organizationId)).defaultMarkupBps;
      const nomes = new Map(brutas.map(({ oferta }, indice) => [gravadas[indice]?.id ?? '', oferta.supplierName]));
      return {
        queryId: consulta.id,
        query: input.q,
        vehicleLabel: veiculo ? `${veiculo.make} ${veiculo.model}${veiculo.plate ? ` · ${veiculo.plate}` : ''}` : null,
        markupBps,
        offers: montarOfertas(gravadas, nomes, markupBps),
        providers: status,
      };
    });
  }

  /** A busca de novo, como foi gravada — o link da busca continua valendo. */
  async get(auth: AuthContext, queryId: string): Promise<PartSearchResult> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const linhas = await repo.offersOfQuery(tx, auth.organizationId, queryId);
      if (!linhas.length) throw notFound('Busca não encontrada.');
      const markupBps = (await readOrganizationSettings(tx, auth.organizationId)).defaultMarkupBps;
      const nomes = new Map(linhas.map((linha) => [linha.offer.id, linha.supplierName]));
      return {
        queryId,
        query: linhas[0]!.offer.title,
        vehicleLabel: null,
        markupBps,
        offers: montarOfertas(
          linhas.map((linha) => linha.offer),
          nomes,
          markupBps,
        ),
        providers: [],
      };
    });
  }

  /**
   * "Adicionar à OS": a oferta vira item de peça, com o preço que a oficina vai
   * cobrar (custo + margem, editável). Quem grava é o service da OS — as regras
   * de item, total e permissão são de lá, e duplicá-las aqui seria garantir que
   * um dia divirjam.
   */
  async addToWorkOrder(
    auth: AuthContext,
    offerId: string,
    input: AddOfferToWorkOrderInput,
    client: ClientInfo,
  ): Promise<WorkOrder> {
    const { oferta, sugerido } = await withTenant(this.deps.db, auth, async (tx) => {
      const linha = await repo.findOffer(tx, auth.organizationId, offerId);
      if (!linha) throw notFound('Oferta não encontrada.');
      if (linha.offer.availability === 'UNAVAILABLE') {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          'Oferta sem estoque',
          'O fornecedor respondeu que não tem esta peça.',
        );
      }
      const markupBps = (await readOrganizationSettings(tx, auth.organizationId)).defaultMarkupBps;
      return { oferta: linha.offer, sugerido: suggestedSalePrice(custoTotalCents(linha.offer), markupBps) };
    });

    const emEstoque = oferta.provider === 'internal' && oferta.availability === 'IN_STOCK';
    return this.workOrders.addItem(
      auth,
      input.workOrderId,
      {
        type: 'PART',
        partId: oferta.partId,
        serviceId: null,
        description: oferta.partId ? '' : oferta.title,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents ?? sugerido,
        discountCents: 0,
        isOptional: input.isOptional,
        sourcing: emEstoque ? 'STOCK' : 'TO_ORDER',
        mechanicUserId: null,
        estimatedMinutes: null,
      },
      client,
    );
  }

  // --------------------- lista de preço do fornecedor ---------------------

  async priceList(
    auth: AuthContext,
    supplierId: string,
    query: { q?: string; page: number; pageSize: number },
  ): Promise<PriceList> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const fornecedor = await repo.findSupplier(tx, auth.organizationId, supplierId);
      if (!fornecedor) throw notFound('Fornecedor não encontrado.');
      const { rows, total, importedAt } = await repo.listPriceListItems(tx, auth.organizationId, supplierId, {
        q: query.q,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      return {
        supplierId,
        supplierName: fornecedor.name,
        itemCount: total,
        importedAt: importedAt ? importedAt.toISOString() : null,
        items: rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          brand: row.brand,
          priceCents: row.priceCents,
          unit: row.unit,
          updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
        })),
        meta: { page: query.page, pageSize: query.pageSize, total },
      };
    });
  }

  /**
   * Importa a planilha do fornecedor. A regra é a da oficina, não a nossa: a
   * planilha vem como vier, o leitor aceita `;` ou `,`, acha as colunas pelo
   * nome (sem acento) e **diz o que recusou, com o número da linha** — em vez
   * de recusar o arquivo inteiro porque a linha 340 tem "sob consulta".
   */
  async importPriceList(
    auth: AuthContext,
    supplierId: string,
    input: PriceListImportInput,
    client: ClientInfo,
  ): Promise<PriceListImportResult> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const fornecedor = await repo.findSupplier(tx, auth.organizationId, supplierId);
      if (!fornecedor) throw notFound('Fornecedor não encontrado.');

      const { rows } = parseCsv(input.csv);
      if (!rows.length) {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          'Planilha vazia',
          'O arquivo não tem nenhuma linha depois do cabeçalho.',
        );
      }

      const batch = uuidv7();
      const resultado: PriceListImportResult = { imported: 0, updated: 0, removed: 0, skipped: 0, problems: [] };
      for (const [indice, linha] of rows.entries()) {
        // +2: a linha 1 é o cabeçalho, e a pessoa conta a partir de 1 na planilha
        const numeroDaLinha = indice + 2;
        const nome = pegar(linha, COLUNAS.name).trim();
        const precoTexto = pegar(linha, COLUNAS.price);
        const precoCents = parseCsvMoney(precoTexto);
        if (!nome) {
          resultado.skipped += 1;
          if (resultado.problems.length < 20) resultado.problems.push({ line: numeroDaLinha, reason: 'sem descrição' });
          continue;
        }
        if (precoCents === null || precoCents < 0) {
          resultado.skipped += 1;
          if (resultado.problems.length < 20) {
            resultado.problems.push({ line: numeroDaLinha, reason: `preço inválido: "${precoTexto || 'vazio'}"` });
          }
          continue;
        }
        const acao = await repo.upsertPriceListItem(tx, {
          organizationId: auth.organizationId,
          supplierId,
          code: blankToNull(pegar(linha, COLUNAS.code)) ?? null,
          name: nome.slice(0, 200),
          brand: blankToNull(pegar(linha, COLUNAS.brand))?.slice(0, 80) ?? null,
          priceCents: precoCents,
          unit: blankToNull(pegar(linha, COLUNAS.unit))?.slice(0, 10) ?? null,
          importBatch: batch,
        });
        if (acao === 'updated') resultado.updated += 1;
        else resultado.imported += 1;
      }

      if (input.replace) {
        resultado.removed = await repo.deleteItemsOutsideBatch(tx, auth.organizationId, supplierId, batch);
      }

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'supplier.price_list_imported',
        entityType: 'supplier',
        entityId: supplierId,
        metadata: { ...resultado, problems: resultado.problems.length, replace: input.replace },
        ...client,
      });
      return resultado;
    });
  }
}

/** A lista pronta para a tela: ordenada, com selos, margem aplicada e diferença. */
function montarOfertas(
  linhas: repo.PartOfferRow[],
  nomes: Map<string, string | null>,
  markupBps: number,
): PartOffer[] {
  const comparaveis = linhas.map((linha) => ({
    id: linha.id,
    priceCents: linha.priceCents,
    shippingCents: linha.shippingCents,
    leadTimeDays: linha.leadTimeDays,
    availability: linha.availability,
  }));
  const selos = rankOffers(comparaveis);
  const porId = new Map(comparaveis.map((oferta) => [oferta.id, oferta]));

  return ordenarOfertas(comparaveis).map((comparavel) => {
    const linha = linhas.find((item) => item.id === comparavel.id)!;
    const total = custoTotalCents(linha);
    const badges = (Object.entries(selos) as [OfferBadge, string | null][])
      .filter(([, id]) => id === linha.id)
      .map(([badge]) => badge);
    return {
      id: linha.id,
      provider: linha.provider,
      isMock: linha.isMock,
      title: linha.title,
      brand: linha.brand,
      code: linha.code,
      priceCents: linha.priceCents,
      shippingCents: linha.shippingCents,
      totalCents: total,
      availability: linha.availability,
      leadTimeDays: linha.leadTimeDays,
      supplierId: linha.supplierId,
      supplierName: nomes.get(linha.id) ?? null,
      partId: linha.partId,
      availableQuantity: linha.availableQuantity === null ? null : Number(linha.availableQuantity),
      offerUrl: linha.offerUrl,
      fetchedAt: linha.fetchedAt.toISOString(),
      suggestedPriceCents: suggestedSalePrice(total, markupBps),
      priceGapCents: diferencaParaAMaisBarata(porId.get(linha.id)!, comparaveis),
      badges,
    };
  });
}
