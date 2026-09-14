/**
 * Cotação com fornecedores por link (MVP 2, E11). A oficina pede preço a vários
 * fornecedores de uma vez; cada um responde pelo próprio link.
 */

/**
 * OPEN aceita resposta. A primeira escolha de oferta leva a CLOSED: dali em
 * diante o fornecedor não reenvia mais (decisão de 14/09/2026), mas a oficina
 * ainda pode trocar a escolha até comprar. Vencida é OPEN com o prazo passado —
 * calculada, não gravada.
 */
export const SUPPLIER_QUOTE_STATUSES = ['OPEN', 'CLOSED', 'CANCELED'] as const;
export type SupplierQuoteStatus = (typeof SUPPLIER_QUOTE_STATUSES)[number];

export const SUPPLIER_QUOTE_STATUS_LABELS: Record<SupplierQuoteStatus, string> = {
  OPEN: 'Aguardando respostas',
  CLOSED: 'Encerrada',
  CANCELED: 'Cancelada',
};

/** O que o fornecedor diz de cada peça. */
export const OFFER_AVAILABILITIES = ['AVAILABLE', 'TO_ORDER', 'UNAVAILABLE'] as const;
export type OfferAvailability = (typeof OFFER_AVAILABILITIES)[number];

export const OFFER_AVAILABILITY_LABELS: Record<OfferAvailability, string> = {
  AVAILABLE: 'Tem a pronta entrega',
  TO_ORDER: 'Consegue sob encomenda',
  UNAVAILABLE: 'Não tem',
};

/** Validade padrão: oficina precisa de resposta rápida, o carro está parado. */
export const DEFAULT_SUPPLIER_QUOTE_HOURS = 48;
export const MAX_SUPPLIER_QUOTE_HOURS = 7 * 24;

/** Mais que isso vira spam para o fornecedor e ruído para a oficina. */
export const MAX_SUPPLIERS_PER_QUOTE = 10;
export const MAX_ITEMS_PER_SUPPLIER_QUOTE = 50;

/** Origem de um preço no histórico da peça. */
export const PRICE_SOURCES = ['RFQ', 'PURCHASE', 'PRICE_LIST', 'PROVIDER'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
