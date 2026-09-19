import type { PartOfferAvailability, PartSearchProviderId } from '@oficinaos/shared';
import type { Tx } from '../../db/tenant';

/**
 * Pesquisa de peças (docs/ARCHITECTURE.md §12). O domínio conhece **esta**
 * interface, nunca a fonte: estoque próprio, lista de preço importada, cotação
 * respondida — e, no dia em que houver API oficial e termos que permitam, um
 * marketplace entra como mais um provider, sem tocar no resto.
 *
 * Diferença da interface esboçada na Fase 0: os providers de hoje leem o banco
 * da própria oficina, então recebem a transação. Provider externo simplesmente
 * ignora o `tx` e usa `fetch` com o `signal`.
 */
export interface PartSearchContext {
  tx: Tx;
  organizationId: string;
  /** o carro da OS, quando a busca partiu de uma: serve para filtrar aplicação */
  vehicle?: { id: string; make: string; model: string; yearModel: number | null } | null;
  signal?: AbortSignal;
}

export interface RawOffer {
  title: string;
  brand: string | null;
  code: string | null;
  priceCents: number;
  shippingCents: number;
  availability: PartOfferAvailability;
  leadTimeDays: number | null;
  supplierId: string | null;
  supplierName: string | null;
  partId: string | null;
  availableQuantity: number | null;
  offerUrl: string | null;
  raw?: Record<string, unknown>;
}

export interface PartSearchProvider {
  readonly id: PartSearchProviderId;
  readonly isMock: boolean;
  readonly capabilities: { price: boolean; shipping: boolean; stock: boolean; fitment: boolean };
  search(ctx: PartSearchContext, query: string): Promise<RawOffer[]>;
}

/** Teto de ofertas por provider: a tela compara, não lista catálogo inteiro. */
export const MAX_OFFERS_PER_PROVIDER = 12;
