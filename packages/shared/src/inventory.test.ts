import { describe, expect, it } from 'vitest';
import { stockStatus, stockValueCents, suggestedSalePrice, weightedAverageCost } from './inventory';

describe('custo médio móvel', () => {
  it('pondera saldo e entrada', () => {
    // 10 un a R$ 10,00 + 10 un a R$ 20,00 → R$ 15,00
    expect(weightedAverageCost({ onHandMilli: 10_000, averageCostCents: 1000, inMilli: 10_000, unitCostCents: 2000 })).toBe(1500);
    // 3 L a R$ 40,00 + 1,5 L a R$ 46,00 → (120 + 69) / 4,5 = R$ 42,00
    expect(weightedAverageCost({ onHandMilli: 3000, averageCostCents: 4000, inMilli: 1500, unitCostCents: 4600 })).toBe(4200);
  });

  it('arredonda o centavo meio para cima', () => {
    // 1 × 100 + 2 × 101 = 302 / 3 = 100,67 → 101
    expect(weightedAverageCost({ onHandMilli: 1000, averageCostCents: 100, inMilli: 2000, unitCostCents: 101 })).toBe(101);
  });

  it('sem saldo positivo ou sem médio, vale o custo da entrada', () => {
    expect(weightedAverageCost({ onHandMilli: 0, averageCostCents: 1000, inMilli: 5000, unitCostCents: 3000 })).toBe(3000);
    expect(weightedAverageCost({ onHandMilli: -2000, averageCostCents: 1000, inMilli: 5000, unitCostCents: 3000 })).toBe(3000);
    expect(weightedAverageCost({ onHandMilli: 4000, averageCostCents: null, inMilli: 1000, unitCostCents: 2500 })).toBe(2500);
  });

  it('não perde precisão com estoque grande', () => {
    expect(
      weightedAverageCost({ onHandMilli: 999_999_000, averageCostCents: 99_999_999, inMilli: 1000, unitCostCents: 1 }),
    ).toBe(99_999_899);
  });
});

describe('preço sugerido e valor do estoque', () => {
  it('aplica a margem sobre o custo', () => {
    expect(suggestedSalePrice(18000, 3000)).toBe(23400); // R$ 180 + 30% = R$ 234 (exemplo do briefing)
    expect(suggestedSalePrice(999, 0)).toBe(999);
  });

  it('valor ao custo médio', () => {
    expect(stockValueCents(4500, 4200)).toBe(18900);
    expect(stockValueCents(-1000, 4200)).toBe(0);
    expect(stockValueCents(1000, null)).toBe(0);
  });
});

describe('situação do estoque', () => {
  const base = { trackStock: true, onHandMilli: 10_000, reservedMilli: 0, minMilli: 2000 };
  it('classifica', () => {
    expect(stockStatus(base)).toBe('OK');
    expect(stockStatus({ ...base, reservedMilli: 9000 })).toBe('LOW');
    expect(stockStatus({ ...base, reservedMilli: 10_000 })).toBe('OUT');
    expect(stockStatus({ ...base, onHandMilli: -1000 })).toBe('NEGATIVE');
    expect(stockStatus({ ...base, trackStock: false, onHandMilli: -5 })).toBe('NOT_TRACKED');
    expect(stockStatus({ ...base, minMilli: 0, onHandMilli: 1 })).toBe('OK');
  });
});
