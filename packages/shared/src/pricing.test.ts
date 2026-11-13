import { describe, expect, it } from 'vitest';
import {
  computeApprovedTotals,
  computeQuoteSelectionTotals,
  computeQuoteTotals,
  computeTotals,
  discountCentsFor,
  isDiscountWithinLimit,
  lineGrossCents,
  lineTotalCents,
  type PricingLine,
} from './pricing';

const service = (priceCents: number, overrides: Partial<PricingLine> = {}): PricingLine => ({
  type: 'SERVICE',
  quantityMilli: 1000,
  unitPriceCents: priceCents,
  discountCents: 0,
  ...overrides,
});

const part = (priceCents: number, overrides: Partial<PricingLine> = {}): PricingLine => ({
  type: 'PART',
  quantityMilli: 1000,
  unitPriceCents: priceCents,
  discountCents: 0,
  ...overrides,
});

describe('linha do orçamento', () => {
  it('quantidade fracionada: 4,5 L de óleo a R$ 42,00', () => {
    expect(lineGrossCents(4500, 4200)).toBe(18900);
  });

  it('arredonda meio para cima, na linha', () => {
    expect(lineGrossCents(1500, 1)).toBe(2); // 1,5 × R$ 0,01 = R$ 0,015
    expect(lineGrossCents(333, 3000)).toBe(999); // 0,333 × R$ 30,00
    expect(lineGrossCents(2500, 101)).toBe(253); // 2,5 × R$ 1,01 = R$ 2,525
  });

  it('desconto da linha maior que o bruto não deixa a linha negativa', () => {
    expect(lineTotalCents(service(10000, { discountCents: 15000 }))).toBe(0);
  });

  it('item de cortesia (preço zero) continua na conta', () => {
    expect(lineTotalCents(service(0))).toBe(0);
  });
});

describe('totais da OS', () => {
  it('separa peças e serviços', () => {
    const totals = computeTotals([service(12000), part(8000), part(4500)]);
    expect(totals).toMatchObject({
      servicesSubtotalCents: 12000,
      partsSubtotalCents: 12500,
      subtotalCents: 24500,
      discountCents: 0,
      totalCents: 24500,
    });
  });

  it('desconto percentual e arredondamento meio para cima', () => {
    expect(discountCentsFor(101, 'PERCENT', 5000)).toBe(51); // 50% de R$ 1,01 = R$ 0,505
    expect(computeTotals([service(100000)], { discountMode: 'PERCENT', discountValue: 1000 })).toMatchObject({
      discountCents: 10000,
      totalCents: 90000,
    });
  });

  it('desconto nunca passa do subtotal, nos dois modos', () => {
    expect(computeTotals([service(50000)], { discountMode: 'AMOUNT', discountValue: 90000 })).toMatchObject({
      discountCents: 50000,
      totalCents: 0,
    });
    expect(computeTotals([service(50000)], { discountMode: 'PERCENT', discountValue: 15_000 })).toMatchObject({
      discountCents: 50000,
      totalCents: 0,
    });
  });

  it('acréscimo entra depois do desconto', () => {
    expect(
      computeTotals([service(10000)], { discountMode: 'AMOUNT', discountValue: 2000, surchargeCents: 500 }),
    ).toMatchObject({ discountCents: 2000, surchargeCents: 500, totalCents: 8500 });
  });

  it('OS sem item: tudo zero, sem dividir por zero', () => {
    expect(computeTotals([], { discountMode: 'PERCENT', discountValue: 1000 })).toMatchObject({
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
  });
});

describe('aprovação parcial', () => {
  const lines = [service(70000, { approved: true }), part(30000, { isOptional: true })];

  it('só o que foi aprovado entra no total', () => {
    expect(computeApprovedTotals(lines)).toMatchObject({
      servicesSubtotalCents: 70000,
      partsSubtotalCents: 0,
      subtotalCents: 70000,
      totalCents: 70000,
    });
  });

  it('desconto percentual incide sobre o aprovado', () => {
    expect(computeApprovedTotals(lines, { discountMode: 'PERCENT', discountValue: 1000 })).toMatchObject({
      discountCents: 7000,
      totalCents: 63000,
    });
  });

  it('desconto em valor é rateado pela fração aprovada', () => {
    // R$ 100,00 de desconto sobre R$ 1.000,00; aprovado R$ 700,00 → R$ 70,00
    expect(computeApprovedTotals(lines, { discountMode: 'AMOUNT', discountValue: 10000 })).toMatchObject({
      discountCents: 7000,
      totalCents: 63000,
    });
  });

  it('nada aprovado: total zero e desconto zero', () => {
    expect(computeApprovedTotals([service(70000), part(30000)], { discountMode: 'AMOUNT', discountValue: 10000 })).toMatchObject({
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
  });
});

describe('limite de desconto por papel', () => {
  it('até o limite passa; um centavo acima, não', () => {
    expect(isDiscountWithinLimit(100000, 10000, 1000)).toBe(true);
    expect(isDiscountWithinLimit(100000, 10001, 1000)).toBe(false);
  });

  it('limite zero barra qualquer desconto, e desconto zero sempre passa', () => {
    expect(isDiscountWithinLimit(100000, 1, 0)).toBe(false);
    expect(isDiscountWithinLimit(100000, 0, 0)).toBe(true);
  });
});

describe('orçamento: os totais congelados no envio', () => {
  const novo = (line: PricingLine) => ({ ...line, undecided: true, chosen: true });

  it('sem desconto: total = subtotal, e a regra fica vazia', () => {
    expect(computeQuoteTotals([novo(service(15000)), novo(part(5000))])).toEqual({
      subtotalCents: 20000,
      discountMode: null,
      discountValue: 0,
      discountCents: 0,
      surchargeCents: 0,
      totalCents: 20000,
    });
  });

  it('percentual sobre serviço e peça: R$ 200 com 10% = R$ 180', () => {
    expect(computeQuoteTotals([novo(service(15000)), novo(part(5000))], { discountMode: 'PERCENT', discountValue: 1000 })).toEqual({
      subtotalCents: 20000,
      discountMode: 'PERCENT',
      discountValue: 1000,
      discountCents: 2000,
      surchargeCents: 0,
      totalCents: 18000,
    });
  });

  it('valor fixo com centavos, e o acréscimo da OS', () => {
    expect(
      computeQuoteTotals([novo(service(12345)), novo(part(6789))], { discountMode: 'AMOUNT', discountValue: 1999, surchargeCents: 250 }),
    ).toMatchObject({ subtotalCents: 19134, discountCents: 1999, surchargeCents: 250, totalCents: 17385 });
  });

  it('percentual com centavos arredonda meio para cima: 12,5% de R$ 99,99', () => {
    expect(computeQuoteTotals([novo(service(9999))], { discountMode: 'PERCENT', discountValue: 1250 })).toMatchObject({
      discountCents: 1250, // 1249,875 → 1250
      totalCents: 8749,
    });
  });

  it('modo sem valor não vira regra de desconto', () => {
    expect(computeQuoteTotals([novo(service(10000))], { discountMode: 'PERCENT', discountValue: 0 })).toMatchObject({
      discountMode: null,
      totalCents: 10000,
    });
  });

  it('complementar: o valor fixo já concedido não se repete, nem o acréscimo', () => {
    const aprovado = service(10000, { approved: true });
    const linhas = [{ ...aprovado, chosen: false }, novo(part(10000))];
    expect(computeQuoteTotals(linhas, { discountMode: 'AMOUNT', discountValue: 2000, surchargeCents: 500 })).toMatchObject({
      subtotalCents: 10000,
      discountCents: 0,
      surchargeCents: 0,
      totalCents: 10000,
    });
    // percentual vale de novo sobre o complementar
    expect(computeQuoteTotals(linhas, { discountMode: 'PERCENT', discountValue: 1000 })).toMatchObject({ discountCents: 1000 });
  });

  it('complementar depois de aprovação parcial leva só o resto do valor fixo', () => {
    // R$ 20 sobre A (100) + B (100); B recusado → A ficou com R$ 10. Sobram R$ 10.
    const linhas = [
      { ...service(10000, { approved: true }), chosen: false },
      { ...part(10000), chosen: false },
      novo(part(5000)),
    ];
    expect(computeQuoteTotals(linhas, { discountMode: 'AMOUNT', discountValue: 2000 })).toMatchObject({
      discountCents: 1000,
      totalCents: 4000,
    });
  });

  it('item novo na OS não diminui o desconto do que já foi aprovado', () => {
    const opcoes = { discountMode: 'AMOUNT' as const, discountValue: 2000 };
    const antes = computeApprovedTotals([service(10000, { approved: true })], opcoes);
    const depois = computeApprovedTotals([service(10000, { approved: true }), part(10000, { undecided: true })], opcoes);
    expect(depois.totalCents).toBe(antes.totalCents);
    expect(depois.totalCents).toBe(8000);
  });
});

describe('orçamento: a seleção que o cliente aprova', () => {
  const itens = (aprovados: boolean[], valores = [15000, 5000]) =>
    valores.map((totalCents, i) => ({ totalCents, approved: aprovados[i] ?? false }));

  it('tudo aprovado = exatamente o total do orçamento', () => {
    const quote = { subtotalCents: 20000, discountMode: 'PERCENT' as const, discountValue: 1000, discountCents: 2000, surchargeCents: 0 };
    expect(computeQuoteSelectionTotals(quote, itens([true, true]))).toEqual({
      subtotalCents: 20000,
      discountCents: 2000,
      surchargeCents: 0,
      totalCents: 18000,
    });
  });

  it('parcial com percentual: o percentual sobre o aprovado', () => {
    const quote = { subtotalCents: 20000, discountMode: 'PERCENT' as const, discountValue: 1000, discountCents: 2000, surchargeCents: 0 };
    expect(computeQuoteSelectionTotals(quote, itens([true, false]))).toMatchObject({ discountCents: 1500, totalCents: 13500 });
  });

  it('parcial com valor fixo: rateado pela fração aprovada, com centavos', () => {
    // R$ 33,33 de desconto; aprovado 1/3 do subtotal → R$ 11,11
    const quote = { subtotalCents: 30000, discountMode: 'AMOUNT' as const, discountValue: 3333, discountCents: 3333, surchargeCents: 0 };
    expect(computeQuoteSelectionTotals(quote, itens([true, false], [10000, 20000]))).toMatchObject({
      discountCents: 1111,
      totalCents: 8889,
    });
  });

  it('o rateio usa o desconto DO orçamento, não o valor cheio da OS', () => {
    // complementar que levou só R$ 10 dos R$ 20 da OS
    const quote = { subtotalCents: 20000, discountMode: 'AMOUNT' as const, discountValue: 2000, discountCents: 1000, surchargeCents: 0 };
    expect(computeQuoteSelectionTotals(quote, itens([true, false], [10000, 10000]))).toMatchObject({ discountCents: 500 });
  });

  it('acréscimo inteiro se algo foi aprovado; nada aprovado, total zero', () => {
    const quote = { subtotalCents: 20000, discountMode: null, discountValue: 0, discountCents: 0, surchargeCents: 300 };
    expect(computeQuoteSelectionTotals(quote, itens([false, true]))).toMatchObject({ totalCents: 5300 });
    expect(computeQuoteSelectionTotals(quote, itens([false, false]))).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      surchargeCents: 0,
      totalCents: 0,
    });
  });

  it('orçamento antigo (desconto 0 gravado): a seleção é a soma dos itens', () => {
    const quote = { subtotalCents: 20000, discountMode: null, discountValue: 0, discountCents: 0, surchargeCents: 0 };
    expect(computeQuoteSelectionTotals(quote, itens([true, false])).totalCents).toBe(15000);
  });
});
