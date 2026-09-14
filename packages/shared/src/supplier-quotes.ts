/**
 * Regras puras da cotação com fornecedores por link (MVP 2, E11).
 *
 * Moram aqui, e não na API, pelo mesmo motivo do `pricing.ts`: são contas que a
 * tela da oficina, a página do fornecedor e a API precisam fazer IGUAL. E porque
 * a mais sensível delas — o que do carro sai da oficina — precisa de teste sem
 * banco nenhum no caminho.
 */

import type { OfferAvailability, SupplierQuoteStatus } from './enums/supplier-quotes';

// ------------------------------ o veículo ---------------------------------

/** O carro como está na oficina: tem placa e chassi. */
export interface VehicleForQuote {
  make: string;
  model: string;
  version: string | null;
  yearModel: number | null;
  yearManufacture: number | null;
  engine: string | null;
  vin: string | null;
  plate: string | null;
}

/** O carro como o fornecedor vê: sem placa nunca, com chassi só se a oficina pedir. */
export interface VehicleForSupplier {
  make: string;
  model: string;
  version: string | null;
  year: number | null;
  engine: string | null;
  vin: string | null;
}

/**
 * O que do carro vai para o fornecedor (decisão de 14/09/2026).
 *
 * A **placa nunca vai**: pela placa se chega ao dono do carro, e o fornecedor
 * não tem nada com o cliente da oficina (LGPD). O **chassi só vai quando a
 * oficina marca** naquela cotação — é o que acerta câmbio e injeção, mas não
 * precisa sair em toda cotação de pastilha de freio.
 *
 * A saída é montada campo a campo, nunca com spread da entrada: um campo novo
 * no veículo (renavam, cor, dono) não pode vazar sozinho para o fornecedor.
 */
export function vehicleForSupplier(vehicle: VehicleForQuote, includeVin: boolean): VehicleForSupplier {
  return {
    make: vehicle.make,
    model: vehicle.model,
    version: vehicle.version,
    // o ano que importa para peça é o do modelo; sem ele, o de fabricação
    year: vehicle.yearModel ?? vehicle.yearManufacture,
    engine: vehicle.engine,
    vin: includeVin ? vehicle.vin : null,
  };
}

// --------------------------- o conteúdo congelado ---------------------------

export interface CanonicalRequestItem {
  id: string;
  description: string;
  partCode: string | null;
  brand: string | null;
  /** em milésimos, como o resto do domínio de quantidade */
  quantityMilli: number;
  unit: string;
}

export interface CanonicalSupplierQuote {
  items: readonly CanonicalRequestItem[];
  vehicle: VehicleForSupplier | null;
  message: string | null;
  expiresAt: string;
}

/**
 * O texto do qual sai o hash da cotação. É o que o fornecedor VIU: se a oficina
 * pudesse mudar um item depois de enviar, ele estaria respondendo uma coisa e a
 * oficina lendo outra. A resposta carrega este hash, e a API recusa se não bater.
 *
 * Ordem fixa de chaves e itens por id: o mesmo conteúdo sempre dá o mesmo texto.
 */
export function canonicalSupplierQuotePayload(quote: CanonicalSupplierQuote): string {
  const items = [...quote.items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => [item.id, item.description, item.partCode, item.brand, item.quantityMilli, item.unit]);
  const vehicle = quote.vehicle
    ? [quote.vehicle.make, quote.vehicle.model, quote.vehicle.version, quote.vehicle.year, quote.vehicle.engine, quote.vehicle.vin]
    : null;
  return JSON.stringify({ v: 1, items, vehicle, message: quote.message, expiresAt: quote.expiresAt });
}

// ------------------------------ a validade --------------------------------

/** Aceita resposta: aberta e dentro do prazo. Vencida é calculada, não gravada. */
export function isSupplierQuoteAnswerable(
  request: { status: SupplierQuoteStatus; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return request.status === 'OPEN' && request.expiresAt.getTime() > now.getTime();
}

export function isSupplierQuoteExpired(
  request: { status: SupplierQuoteStatus; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return request.status === 'OPEN' && request.expiresAt.getTime() <= now.getTime();
}

// ------------------------------ a comparação --------------------------------

export interface OfferLine {
  /** a linha da resposta (é o que a oficina escolhe) */
  responseItemId: string;
  requestItemId: string;
  supplierId: string;
  availability: OfferAvailability;
  unitPriceCents: number | null;
  leadTimeDays: number | null;
}

export interface SupplierResponseVersion {
  inviteId: string;
  supplierId: string;
  version: number;
  shippingCents: number | null;
  items: readonly OfferLine[];
}

/**
 * Vale a ÚLTIMA versão de cada fornecedor (decisão de 14/09/2026: ele pode
 * corrigir, e tudo fica guardado). As anteriores continuam existindo como prova,
 * mas não entram na conta.
 */
export function latestVersions<T extends { inviteId: string; version: number }>(responses: readonly T[]): T[] {
  const porConvite = new Map<string, T>();
  for (const resposta of responses) {
    const atual = porConvite.get(resposta.inviteId);
    if (!atual || resposta.version > atual.version) porConvite.set(resposta.inviteId, resposta);
  }
  return [...porConvite.values()];
}

/** Oferta que dá para comprar: tem preço e o fornecedor não disse "não tenho". */
export const isValidOffer = (offer: OfferLine): boolean =>
  offer.availability !== 'UNAVAILABLE' && offer.unitPriceCents !== null && offer.unitPriceCents >= 0;

export interface ItemComparison {
  requestItemId: string;
  /** as ofertas válidas, do menor preço para o maior */
  offers: OfferLine[];
  /** menor preço unitário; empate vai para o prazo menor, depois para o id (estável) */
  cheapest: OfferLine | null;
  /** menor prazo entre as ofertas válidas com prazo informado; empate vai para o preço */
  fastest: OfferLine | null;
}

const porPreco = (a: OfferLine, b: OfferLine) =>
  a.unitPriceCents! - b.unitPriceCents! ||
  (a.leadTimeDays ?? Number.POSITIVE_INFINITY) - (b.leadTimeDays ?? Number.POSITIVE_INFINITY) ||
  a.responseItemId.localeCompare(b.responseItemId);

const porPrazo = (a: OfferLine, b: OfferLine) =>
  a.leadTimeDays! - b.leadTimeDays! || a.unitPriceCents! - b.unitPriceCents! || a.responseItemId.localeCompare(b.responseItemId);

/**
 * Lado a lado, por item. O "melhor" é por PEÇA, e não por fornecedor: a oficina
 * compra a pastilha de um e o disco de outro. Frete não entra aqui porque é por
 * fornecedor, não por item — ele aparece no resumo de cada fornecedor.
 */
export function compareOffers(
  requestItemIds: readonly string[],
  latest: readonly SupplierResponseVersion[],
): ItemComparison[] {
  const validas = latest.flatMap((resposta) => resposta.items.filter(isValidOffer));
  return requestItemIds.map((requestItemId) => {
    const offers = validas.filter((oferta) => oferta.requestItemId === requestItemId).sort(porPreco);
    const comPrazo = offers.filter((oferta) => oferta.leadTimeDays !== null).sort(porPrazo);
    return {
      requestItemId,
      offers,
      cheapest: offers[0] ?? null,
      fastest: comPrazo[0] ?? null,
    };
  });
}

export interface SupplierSummary {
  supplierId: string;
  /** itens que ele consegue atender */
  coveredItems: number;
  /** soma de preço × quantidade só dos itens que ele atende */
  itemsTotalCents: number;
  shippingCents: number;
  totalCents: number;
}

/**
 * O resumo de cada fornecedor: quanto sairia comprar dele tudo o que ele tem,
 * com o frete. É onde o frete pesa — um fornecedor barato por peça pode sair
 * caro no total.
 */
export function summarizeSuppliers(
  latest: readonly SupplierResponseVersion[],
  quantityMilliByItem: ReadonlyMap<string, number>,
): SupplierSummary[] {
  return latest.map((resposta) => {
    const validas = resposta.items.filter(isValidOffer);
    const itemsTotalCents = validas.reduce((soma, oferta) => {
      const milli = quantityMilliByItem.get(oferta.requestItemId) ?? 0;
      // arredondamento só no fim da linha, como no pricing.ts
      return soma + Math.round((oferta.unitPriceCents! * milli) / 1000);
    }, 0);
    const shippingCents = resposta.shippingCents ?? 0;
    return {
      supplierId: resposta.supplierId,
      coveredItems: validas.length,
      itemsTotalCents,
      shippingCents,
      totalCents: itemsTotalCents + shippingCents,
    };
  });
}
