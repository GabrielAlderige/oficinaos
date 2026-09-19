import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { parseQuantity } from '@oficinaos/shared';
import { likeContains } from '../../core/normalize';
import { partMatches } from '../../modules/parts/parts.repository';
import {
  parts,
  supplierPriceListItems,
  supplierQuoteInvites,
  supplierQuoteRequestItems,
  supplierQuoteRequests,
  supplierQuoteResponseItems,
  supplierQuoteResponses,
  suppliers,
} from '../../db/schema';
import { MAX_OFFERS_PER_PROVIDER, type PartSearchProvider, type RawOffer } from './types';

const milli = (valor: string | null) => (valor === null ? null : (parseQuantity(valor) ?? 0) / 1000);

/**
 * 1) O estoque da própria oficina. É a primeira pergunta de qualquer balcão —
 * "tem aí?" — e a única oferta com prazo zero e frete zero. O "preço" é o
 * custo médio: a comparação é sobre quanto a peça CUSTA para a oficina.
 */
const internalInventory: PartSearchProvider = {
  id: 'internal',
  isMock: false,
  capabilities: { price: true, shipping: false, stock: true, fitment: true },
  async search({ tx, organizationId }, query) {
    const filtro = partMatches(query);
    const linhas = await tx
      .select({
        id: parts.id,
        name: parts.name,
        manufacturer: parts.manufacturer,
        manufacturerCode: parts.manufacturerCode,
        sku: parts.sku,
        averageCostCents: parts.averageCostCents,
        lastCostCents: parts.lastCostCents,
        onHand: parts.quantityOnHand,
        reserved: parts.quantityReserved,
        trackStock: parts.trackStock,
        supplierId: parts.preferredSupplierId,
        supplierName: suppliers.name,
        supplierLeadTime: suppliers.leadTimeDays,
      })
      .from(parts)
      .leftJoin(suppliers, and(eq(suppliers.organizationId, parts.organizationId), eq(suppliers.id, parts.preferredSupplierId)))
      .where(and(eq(parts.organizationId, organizationId), isNull(parts.deletedAt), filtro))
      .limit(MAX_OFFERS_PER_PROVIDER);

    return linhas.map((linha): RawOffer => {
      const disponivel = linha.trackStock ? (milli(linha.onHand) ?? 0) - (milli(linha.reserved) ?? 0) : null;
      const temEstoque = disponivel !== null && disponivel > 0;
      return {
        title: linha.name,
        brand: linha.manufacturer,
        code: linha.manufacturerCode ?? linha.sku,
        // sem custo médio ainda (peça nunca comprada), o último custo serve
        priceCents: linha.averageCostCents ?? linha.lastCostCents ?? 0,
        shippingCents: 0,
        availability: temEstoque ? 'IN_STOCK' : 'TO_ORDER',
        leadTimeDays: temEstoque ? 0 : linha.supplierLeadTime,
        supplierId: temEstoque ? null : linha.supplierId,
        supplierName: temEstoque ? null : linha.supplierName,
        partId: linha.id,
        availableQuantity: disponivel,
        offerUrl: null,
        raw: { origem: 'catalogo', custoMedio: linha.averageCostCents, ultimoCusto: linha.lastCostCents },
      };
    });
  },
};

/**
 * 2) A lista de preço que o fornecedor mandou, importada de CSV no cadastro
 * dele. É o "catálogo" que a oficina realmente tem em mãos.
 */
const priceList: PartSearchProvider = {
  id: 'price_list',
  isMock: false,
  capabilities: { price: true, shipping: false, stock: false, fitment: false },
  async search({ tx, organizationId }, query) {
    const padrao = likeContains(query);
    const linhas = await tx
      .select({
        id: supplierPriceListItems.id,
        code: supplierPriceListItems.code,
        name: supplierPriceListItems.name,
        brand: supplierPriceListItems.brand,
        priceCents: supplierPriceListItems.priceCents,
        unit: supplierPriceListItems.unit,
        updatedAt: supplierPriceListItems.updatedAt,
        supplierId: suppliers.id,
        supplierName: suppliers.name,
        leadTimeDays: suppliers.leadTimeDays,
      })
      .from(supplierPriceListItems)
      .innerJoin(
        suppliers,
        and(
          eq(suppliers.organizationId, supplierPriceListItems.organizationId),
          eq(suppliers.id, supplierPriceListItems.supplierId),
        ),
      )
      .where(
        and(
          eq(supplierPriceListItems.organizationId, organizationId),
          isNull(suppliers.deletedAt),
          sql`(immutable_unaccent(${supplierPriceListItems.name}) ilike immutable_unaccent(${padrao})
               or ${supplierPriceListItems.code} ilike ${padrao}
               or immutable_unaccent(coalesce(${supplierPriceListItems.brand}, '')) ilike immutable_unaccent(${padrao}))`,
        ),
      )
      .orderBy(supplierPriceListItems.priceCents)
      .limit(MAX_OFFERS_PER_PROVIDER);

    return linhas.map(
      (linha): RawOffer => ({
        title: linha.name,
        brand: linha.brand,
        code: linha.code,
        priceCents: linha.priceCents,
        shippingCents: 0,
        availability: 'TO_ORDER',
        leadTimeDays: linha.leadTimeDays,
        supplierId: linha.supplierId,
        supplierName: linha.supplierName,
        partId: null,
        availableQuantity: null,
        offerUrl: null,
        raw: { origem: 'lista_de_preco', unidade: linha.unit },
      }),
    );
  },
};

/**
 * 3) O que os fornecedores já responderam nas cotações por link (E11). É o
 * preço mais confiável que existe aqui: foi cotado para esta oficina, com nome,
 * marca e prazo. Vale a resposta mais recente de cada fornecedor.
 */
const supplierQuotes: PartSearchProvider = {
  id: 'rfq',
  isMock: false,
  capabilities: { price: true, shipping: true, stock: false, fitment: false },
  async search({ tx, organizationId }, query) {
    const padrao = likeContains(query);
    const linhas = await tx
      .select({
        id: supplierQuoteResponseItems.id,
        description: supplierQuoteRequestItems.description,
        brand: supplierQuoteResponseItems.brand,
        code: supplierQuoteRequestItems.partCode,
        priceCents: supplierQuoteResponseItems.unitPriceCents,
        shippingCents: supplierQuoteResponses.shippingCents,
        availability: supplierQuoteResponseItems.availability,
        leadTimeDays: supplierQuoteResponseItems.leadTimeDays,
        supplierId: supplierQuoteInvites.supplierId,
        supplierName: suppliers.name,
        partId: supplierQuoteRequestItems.partId,
        respondedAt: supplierQuoteResponses.createdAt,
        requestNumber: supplierQuoteRequests.number,
      })
      .from(supplierQuoteResponseItems)
      .innerJoin(
        supplierQuoteResponses,
        and(
          eq(supplierQuoteResponses.organizationId, supplierQuoteResponseItems.organizationId),
          eq(supplierQuoteResponses.id, supplierQuoteResponseItems.responseId),
        ),
      )
      .innerJoin(
        supplierQuoteInvites,
        and(
          eq(supplierQuoteInvites.organizationId, supplierQuoteResponses.organizationId),
          eq(supplierQuoteInvites.id, supplierQuoteResponses.inviteId),
        ),
      )
      .innerJoin(
        supplierQuoteRequestItems,
        and(
          eq(supplierQuoteRequestItems.organizationId, supplierQuoteResponseItems.organizationId),
          eq(supplierQuoteRequestItems.id, supplierQuoteResponseItems.requestItemId),
        ),
      )
      .innerJoin(
        supplierQuoteRequests,
        and(
          eq(supplierQuoteRequests.organizationId, supplierQuoteRequestItems.organizationId),
          eq(supplierQuoteRequests.id, supplierQuoteRequestItems.requestId),
        ),
      )
      .innerJoin(
        suppliers,
        and(eq(suppliers.organizationId, supplierQuoteInvites.organizationId), eq(suppliers.id, supplierQuoteInvites.supplierId)),
      )
      .where(
        and(
          eq(supplierQuoteResponseItems.organizationId, organizationId),
          isNull(suppliers.deletedAt),
          sql`(immutable_unaccent(${supplierQuoteRequestItems.description}) ilike immutable_unaccent(${padrao})
               or coalesce(${supplierQuoteRequestItems.partCode}, '') ilike ${padrao}
               or immutable_unaccent(coalesce(${supplierQuoteResponseItems.brand}, '')) ilike immutable_unaccent(${padrao}))`,
        ),
      )
      .orderBy(desc(supplierQuoteResponses.createdAt))
      .limit(MAX_OFFERS_PER_PROVIDER * 2);

    // uma oferta por fornecedor + peça: a resposta mais nova manda
    const vistos = new Set<string>();
    const ofertas: RawOffer[] = [];
    for (const linha of linhas) {
      const chave = `${linha.supplierId}:${(linha.code ?? linha.description).toLowerCase()}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      ofertas.push({
        title: linha.description,
        brand: linha.brand,
        code: linha.code,
        priceCents: linha.priceCents ?? 0,
        // o frete da resposta é do pedido inteiro; aqui ele não é rateado —
        // a tela diz "frete do pedido", e o rateio de verdade é da compra (E12)
        shippingCents: 0,
        availability: linha.availability === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'TO_ORDER',
        leadTimeDays: linha.leadTimeDays,
        supplierId: linha.supplierId,
        supplierName: linha.supplierName,
        partId: linha.partId,
        availableQuantity: null,
        offerUrl: null,
        raw: {
          origem: 'cotacao',
          cotacao: linha.requestNumber,
          respondidoEm: linha.respondedAt?.toISOString() ?? null,
          freteDoPedidoCents: linha.shippingCents,
        },
      });
      if (ofertas.length >= MAX_OFFERS_PER_PROVIDER) break;
    }
    return ofertas;
  },
};

/**
 * 4) Provider FALSO, desligado por padrão (`PARTS_SEARCH_MOCK=true` liga).
 * Existe para desenvolver a tela sem lista importada, e **toda** oferta dele
 * vem com `isMock`, que a interface mostra como "DADOS DE DEMONSTRAÇÃO"
 * (ARCHITECTURE §12). Nunca é preço real e nunca é ligado em produção.
 */
const mock: PartSearchProvider = {
  id: 'mock',
  isMock: true,
  capabilities: { price: true, shipping: true, stock: true, fitment: false },
  search(_ctx, query) {
    const base = 8_000 + (query.length % 7) * 1_500;
    return Promise.resolve(
      [
        { sufixo: 'linha econômica', fator: 1, frete: 2_900, prazo: 6 },
        { sufixo: 'original', fator: 1.8, frete: 0, prazo: 3 },
        { sufixo: 'pronta entrega', fator: 1.45, frete: 1_500, prazo: 1 },
      ].map(
        (variante): RawOffer => ({
          title: `${query} — ${variante.sufixo}`,
          brand: 'DEMONSTRAÇÃO',
          code: null,
          priceCents: Math.round(base * variante.fator),
          shippingCents: variante.frete,
          availability: 'TO_ORDER',
          leadTimeDays: variante.prazo,
          supplierId: null,
          supplierName: 'Fonte de demonstração',
          partId: null,
          availableQuantity: null,
          offerUrl: null,
          raw: { origem: 'mock' },
        }),
      ),
    );
  },
};

/** Os providers que a oficina tem hoje. Marketplace entra aqui quando puder. */
export function partSearchProviders(options: { mock: boolean }): PartSearchProvider[] {
  return options.mock ? [internalInventory, priceList, supplierQuotes, mock] : [internalInventory, priceList, supplierQuotes];
}
