import { describe, expect, it } from 'vitest';
import {
  computeApprovedTotals,
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
