/**
 * Pesquisa de peças (MVP 2, E14). Cada fonte de preço é um **provider** atrás
 * da mesma interface (docs/ARCHITECTURE.md §12): a oficina pergunta "onde eu
 * arrumo esta peça, por quanto e em quanto tempo", e a resposta vem de todas
 * as fontes ao mesmo tempo.
 */

export const PART_SEARCH_PROVIDERS = ['internal', 'price_list', 'rfq', 'mock'] as const;
export type PartSearchProviderId = (typeof PART_SEARCH_PROVIDERS)[number];

export const PART_SEARCH_PROVIDER_LABELS: Record<PartSearchProviderId, string> = {
  internal: 'Estoque da oficina',
  price_list: 'Lista de preço do fornecedor',
  rfq: 'Cotações respondidas',
  mock: 'Dados de demonstração',
};

export const PART_SEARCH_PROVIDER_HINTS: Record<PartSearchProviderId, string> = {
  internal: 'O que já está na prateleira, pelo custo médio.',
  price_list: 'Planilha que o fornecedor mandou, importada no cadastro dele.',
  rfq: 'O que os fornecedores responderam nas cotações por link.',
  mock: 'Fonte falsa, só para desenvolvimento. Nunca é preço real.',
};

/**
 * Marketplace (Mercado Livre, Amazon) **não** está aqui: entra quando houver
 * API oficial e termos que permitam, um provider por vez, com a verificação
 * documentada. Scraping, nunca (docs/ROADMAP.md).
 */

export const PART_OFFER_AVAILABILITIES = ['IN_STOCK', 'TO_ORDER', 'UNAVAILABLE'] as const;
export type PartOfferAvailability = (typeof PART_OFFER_AVAILABILITIES)[number];

export const PART_OFFER_AVAILABILITY_LABELS: Record<PartOfferAvailability, string> = {
  IN_STOCK: 'Pronta entrega',
  TO_ORDER: 'Sob encomenda',
  UNAVAILABLE: 'Sem estoque',
};

export const PART_OFFER_AVAILABILITY_TONES = {
  IN_STOCK: 'success',
  TO_ORDER: 'info',
  UNAVAILABLE: 'neutral',
} as const satisfies Record<PartOfferAvailability, 'neutral' | 'info' | 'warning' | 'accent' | 'success' | 'danger'>;

/** Os três selos do comparador. A regra de cada um aparece na tela. */
export const OFFER_BADGES = ['best_price', 'fastest', 'best_value'] as const;
export type OfferBadge = (typeof OFFER_BADGES)[number];

export const OFFER_BADGE_LABELS: Record<OfferBadge, string> = {
  best_price: 'Melhor preço',
  fastest: 'Entrega mais rápida',
  best_value: 'Custo-benefício',
};

export const OFFER_BADGE_ICONS: Record<OfferBadge, string> = {
  best_price: '🏆',
  fastest: '⚡',
  best_value: '⭐',
};
