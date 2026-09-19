/**
 * Comparador de ofertas de peça (E14). Regras puras: a API ordena com elas e a
 * tela explica cada selo com as mesmas palavras. Nenhuma "nota secreta" —
 * comparador que a oficina não entende, a oficina não usa.
 */

import type { OfferBadge, PartOfferAvailability } from './enums/parts-search';

export interface OfertaComparavel {
  id: string;
  priceCents: number;
  shippingCents: number;
  /** dias úteis até chegar; `null` = o fornecedor não disse */
  leadTimeDays: number | null;
  availability: PartOfferAvailability;
}

/** O que a oficina vai pagar de verdade: peça + frete. */
export const custoTotalCents = (oferta: { priceCents: number; shippingCents: number }): number =>
  oferta.priceCents + oferta.shippingCents;

/**
 * Quanto vale um dia de espera, em basis points do preço: **2% ao dia**.
 *
 * O número é arbitrário, mas é explícito e aparece na tela ("cada dia de espera
 * conta como 2% do preço"). Com ele, uma peça R$ 10 mais barata que demora uma
 * semana perde para a que chega amanhã — que é exatamente a conta que o dono da
 * oficina faz de cabeça, porque o carro parado no elevador custa dinheiro.
 */
export const DIA_DE_ESPERA_BPS = 200;

/** Sem prazo informado, o pessimismo é o padrão: conta como uma semana. */
export const PRAZO_DESCONHECIDO_DIAS = 7;

export const prazoDeEntrega = (oferta: OfertaComparavel): number =>
  oferta.availability === 'IN_STOCK' ? 0 : (oferta.leadTimeDays ?? PRAZO_DESCONHECIDO_DIAS);

/** Custo-benefício: o total acrescido do que a espera custa. Menor é melhor. */
export const custoComEspera = (oferta: OfertaComparavel): number =>
  Math.round((custoTotalCents(oferta) * (10_000 + DIA_DE_ESPERA_BPS * prazoDeEntrega(oferta))) / 10_000);

const comparavel = (oferta: OfertaComparavel) => oferta.availability !== 'UNAVAILABLE' && custoTotalCents(oferta) > 0;

/**
 * Os três selos. Empate resolve pelo que a oficina escolheria: no preço, quem
 * chega antes; na rapidez, quem custa menos. Ofertas sem estoque não ganham
 * selo nenhum — não adianta ser barata se não dá para comprar.
 */
export function rankOffers(ofertas: readonly OfertaComparavel[]): Record<OfferBadge, string | null> {
  const elegiveis = ofertas.filter(comparavel);
  if (!elegiveis.length) return { best_price: null, fastest: null, best_value: null };

  const menor = <T>(lista: T[], chave: (item: T) => [number, number]): T =>
    lista.reduce((melhor, item) => {
      const [a1, a2] = chave(item);
      const [b1, b2] = chave(melhor);
      if (a1 !== b1) return a1 < b1 ? item : melhor;
      return a2 < b2 ? item : melhor;
    });

  return {
    best_price: menor(elegiveis, (o) => [custoTotalCents(o), prazoDeEntrega(o)]).id,
    fastest: menor(elegiveis, (o) => [prazoDeEntrega(o), custoTotalCents(o)]).id,
    best_value: menor(elegiveis, (o) => [custoComEspera(o), custoTotalCents(o)]).id,
  };
}

/** Quanto esta oferta custa a mais que a mais barata (0 se é a mais barata). */
export function diferencaParaAMaisBarata(
  oferta: OfertaComparavel,
  ofertas: readonly OfertaComparavel[],
): number {
  const elegiveis = ofertas.filter(comparavel);
  if (!elegiveis.length) return 0;
  const menor = Math.min(...elegiveis.map(custoTotalCents));
  return Math.max(0, custoTotalCents(oferta) - menor);
}

/**
 * A ordem da lista: as que dá para comprar primeiro, da mais barata para a mais
 * cara (com o frete dentro), e as indisponíveis no fim.
 */
export function ordenarOfertas<T extends OfertaComparavel>(ofertas: readonly T[]): T[] {
  return [...ofertas].sort((a, b) => {
    const disponivel = (o: OfertaComparavel) => (o.availability === 'UNAVAILABLE' ? 1 : 0);
    if (disponivel(a) !== disponivel(b)) return disponivel(a) - disponivel(b);
    return custoTotalCents(a) - custoTotalCents(b);
  });
}
