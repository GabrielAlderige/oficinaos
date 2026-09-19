import { z } from 'zod';
import { OFFER_BADGES, PART_OFFER_AVAILABILITIES, PART_SEARCH_PROVIDERS } from '../enums/parts-search';
import { optionalText } from './common';

/**
 * Pesquisa de peças e comparador (E14). A busca é gravada (`part_search_queries`)
 * com as ofertas que voltaram (`part_offers`): preço de peça é sempre "consultado
 * às 14:32", e sem guardar não dá para explicar de onde veio o custo da OS.
 */

const cents = z.number().int().min(0).max(100_000_000);

export const partSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Digite ao menos duas letras').max(80),
  /** para filtrar por aplicação e mostrar o carro na tela */
  vehicleId: z.uuid().nullable().default(null),
  /** vazio = todos os providers ligados na oficina */
  providers: z.array(z.enum(PART_SEARCH_PROVIDERS)).max(PART_SEARCH_PROVIDERS.length).default([]),
});

export const partOfferSchema = z.object({
  id: z.uuid(),
  provider: z.enum(PART_SEARCH_PROVIDERS),
  /** oferta de fonte de desenvolvimento. A tela avisa, sempre */
  isMock: z.boolean(),
  title: z.string(),
  brand: z.string().nullable(),
  code: z.string().nullable(),
  priceCents: z.number().int(),
  shippingCents: z.number().int(),
  totalCents: z.number().int(),
  availability: z.enum(PART_OFFER_AVAILABILITIES),
  leadTimeDays: z.number().int().nullable(),
  supplierId: z.uuid().nullable(),
  supplierName: z.string().nullable(),
  /** quando é peça do catálogo da oficina, dá para ir direto à ficha */
  partId: z.uuid().nullable(),
  /** saldo disponível, só no provider do estoque */
  availableQuantity: z.number().nullable(),
  offerUrl: z.string().nullable(),
  fetchedAt: z.string(),
  /** o que a oficina cobraria com a margem configurada */
  suggestedPriceCents: z.number().int(),
  /** quanto custa a mais que a mais barata da lista */
  priceGapCents: z.number().int(),
  badges: z.array(z.enum(OFFER_BADGES)),
});

export const providerStatusSchema = z.object({
  provider: z.enum(PART_SEARCH_PROVIDERS),
  /** o provider respondeu? (fora do ar ou lento não derruba a busca) */
  ok: z.boolean(),
  count: z.number().int(),
  message: z.string().nullable(),
  isMock: z.boolean(),
});

export const partSearchResultSchema = z.object({
  queryId: z.uuid(),
  query: z.string(),
  vehicleLabel: z.string().nullable(),
  /** a margem usada para sugerir o preço de venda, em basis points */
  markupBps: z.number().int(),
  offers: z.array(partOfferSchema),
  providers: z.array(providerStatusSchema),
});

/** "Adicionar à OS": a oferta vira item de peça, com o preço que a oficina vai cobrar. */
export const addOfferToWorkOrderSchema = z.object({
  workOrderId: z.uuid(),
  quantity: z.number().min(0.001).max(999_999),
  /** vazio = o sugerido pela margem */
  unitPriceCents: cents.nullable().default(null),
  isOptional: z.boolean().default(false),
});

// --------------------- lista de preço do fornecedor ---------------------

export const priceListImportSchema = z.object({
  /** o CSV inteiro, como texto (o arquivo é lido no navegador) */
  csv: z.string().min(1, 'Arquivo vazio').max(4_000_000, 'Arquivo grande demais (máx. 4 MB)'),
  /** troca a lista inteira em vez de atualizar item a item */
  replace: z.boolean().default(false),
  notes: optionalText(200).default(''),
});

export const priceListItemSchema = z.object({
  id: z.uuid(),
  code: z.string().nullable(),
  name: z.string(),
  brand: z.string().nullable(),
  priceCents: z.number().int(),
  unit: z.string().nullable(),
  updatedAt: z.string(),
});

export const priceListSchema = z.object({
  supplierId: z.uuid(),
  supplierName: z.string(),
  itemCount: z.number().int(),
  importedAt: z.string().nullable(),
  items: z.array(priceListItemSchema),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});

export const priceListImportResultSchema = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
  skipped: z.number().int(),
  /** as primeiras linhas recusadas, com o motivo: planilha nunca vem perfeita */
  problems: z.array(z.object({ line: z.number().int(), reason: z.string() })),
});

export type PartSearchQuery = z.output<typeof partSearchQuerySchema>;
export type PartOffer = z.infer<typeof partOfferSchema>;
export type PartSearchResult = z.infer<typeof partSearchResultSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type AddOfferToWorkOrderInput = z.output<typeof addOfferToWorkOrderSchema>;
export type PriceListImportInput = z.output<typeof priceListImportSchema>;
export type PriceList = z.infer<typeof priceListSchema>;
export type PriceListItem = z.infer<typeof priceListItemSchema>;
export type PriceListImportResult = z.infer<typeof priceListImportResultSchema>;
