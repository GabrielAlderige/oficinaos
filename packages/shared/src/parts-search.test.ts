import { describe, expect, it } from 'vitest';
import {
  custoComEspera,
  custoTotalCents,
  diferencaParaAMaisBarata,
  ordenarOfertas,
  prazoDeEntrega,
  rankOffers,
  type OfertaComparavel,
} from './parts-search';

const oferta = (id: string, patch: Partial<OfertaComparavel> = {}): OfertaComparavel => ({
  id,
  priceCents: 10_000,
  shippingCents: 0,
  leadTimeDays: 2,
  availability: 'TO_ORDER',
  ...patch,
});

describe('comparador de ofertas', () => {
  it('o custo é peça mais frete: a mais barata na etiqueta pode não ser a mais barata', () => {
    const barata = oferta('a', { priceCents: 9_000, shippingCents: 3_000 });
    const cara = oferta('b', { priceCents: 10_000, shippingCents: 0 });
    expect(custoTotalCents(barata)).toBe(12_000);
    expect(rankOffers([barata, cara]).best_price).toBe('b');
  });

  it('pronta entrega tem prazo zero; sem prazo informado, conta como uma semana', () => {
    expect(prazoDeEntrega(oferta('a', { availability: 'IN_STOCK', leadTimeDays: 5 }))).toBe(0);
    expect(prazoDeEntrega(oferta('b', { leadTimeDays: null }))).toBe(7);
  });

  it('cada dia de espera conta como 2% do preço', () => {
    // R$ 100 com 5 dias = R$ 100 × 1,10
    expect(custoComEspera(oferta('a', { priceCents: 10_000, leadTimeDays: 5 }))).toBe(11_000);
    expect(custoComEspera(oferta('b', { priceCents: 10_000, availability: 'IN_STOCK' }))).toBe(10_000);
  });

  it('a mais rápida ganha da mais barata no custo-benefício quando a espera é longa', () => {
    const barataLenta = oferta('lenta', { priceCents: 9_000, leadTimeDays: 10 });
    const caraRapida = oferta('rapida', { priceCents: 10_000, availability: 'IN_STOCK' });
    const selos = rankOffers([barataLenta, caraRapida]);
    expect(selos.best_price).toBe('lenta');
    expect(selos.fastest).toBe('rapida');
    expect(selos.best_value, '9.000 × 1,20 = 10.800 perde para 10.000').toBe('rapida');
  });

  it('empate no preço vai para quem chega antes; empate no prazo, para a mais barata', () => {
    const lenta = oferta('lenta', { leadTimeDays: 9 });
    const rapida = oferta('rapida', { leadTimeDays: 1 });
    expect(rankOffers([lenta, rapida]).best_price).toBe('rapida');

    const cara = oferta('cara', { priceCents: 20_000, availability: 'IN_STOCK' });
    const barata = oferta('barata', { priceCents: 8_000, availability: 'IN_STOCK' });
    expect(rankOffers([cara, barata]).fastest).toBe('barata');
  });

  it('oferta sem estoque não ganha selo nenhum', () => {
    const semEstoque = oferta('sem', { priceCents: 1, availability: 'UNAVAILABLE' });
    const normal = oferta('ok');
    expect(rankOffers([semEstoque, normal])).toEqual({ best_price: 'ok', fastest: 'ok', best_value: 'ok' });
  });

  it('sem nenhuma oferta comprável, não há selo', () => {
    expect(rankOffers([oferta('x', { availability: 'UNAVAILABLE' })])).toEqual({
      best_price: null,
      fastest: null,
      best_value: null,
    });
    expect(rankOffers([])).toEqual({ best_price: null, fastest: null, best_value: null });
  });

  it('a diferença para a mais barata sai em centavos', () => {
    const lista = [oferta('a', { priceCents: 9_000 }), oferta('b', { priceCents: 12_000 })];
    expect(diferencaParaAMaisBarata(lista[1]!, lista)).toBe(3_000);
    expect(diferencaParaAMaisBarata(lista[0]!, lista)).toBe(0);
  });

  it('a lista sai da mais barata para a mais cara, com as indisponíveis no fim', () => {
    const lista = [
      oferta('cara', { priceCents: 30_000 }),
      oferta('sem', { priceCents: 100, availability: 'UNAVAILABLE' }),
      oferta('barata', { priceCents: 10_000 }),
    ];
    expect(ordenarOfertas(lista).map((o) => o.id)).toEqual(['barata', 'cara', 'sem']);
  });
});
