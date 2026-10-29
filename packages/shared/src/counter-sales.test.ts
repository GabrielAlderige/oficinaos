import { describe, expect, it } from 'vitest';
import { counterSaleTotals, createCounterSaleSchema } from './counter-sales';
import { can } from './permissions';

const pedido = {
  clientRequestId: '0192a6d4-8d9b-7c3e-9a1b-2c3d4e5f6a7b',
  items: [{ partId: '0192a6d4-8d9b-7c3e-9a1b-2c3d4e5f6a7c', quantity: 1, unitPriceCents: 4_500 }],
};

describe('venda de balcão (E49)', () => {
  it('soma as linhas como a OS: quantidade fracionada arredonda meio para cima', () => {
    // 4,5 L × R$ 39,99 = R$ 179,955 → R$ 179,96
    expect(counterSaleTotals([{ quantityMilli: 4_500, unitPriceCents: 3_999 }], 0)).toEqual({
      subtotalCents: 17_996,
      discountCents: 0,
      totalCents: 17_996,
    });
  });

  it('o desconto nunca passa do subtotal nem fica negativo', () => {
    const linhas = [{ quantityMilli: 2_000, unitPriceCents: 1_000 }];
    expect(counterSaleTotals(linhas, 5_000).totalCents).toBe(0);
    expect(counterSaleTotals(linhas, 5_000).discountCents).toBe(2_000);
    expect(counterSaleTotals(linhas, -300).discountCents).toBe(0);
  });

  it('fiado só com cliente: a conta a receber precisa de quem cobrar', () => {
    const fiado = createCounterSaleSchema.safeParse({ ...pedido, payment: { kind: 'LATER', dueDate: '2026-11-10' } });
    expect(fiado.success).toBe(false);
    const comCliente = createCounterSaleSchema.safeParse({
      ...pedido,
      customerId: '0192a6d4-8d9b-7c3e-9a1b-2c3d4e5f6a7d',
      payment: { kind: 'LATER', dueDate: '2026-11-10' },
    });
    expect(comCliente.success).toBe(true);
    expect(createCounterSaleSchema.safeParse({ ...pedido, payment: { kind: 'PAID', method: 'PIX' } }).success).toBe(true);
  });

  it('item avulso precisa de descrição', () => {
    const avulso = createCounterSaleSchema.safeParse({
      ...pedido,
      items: [{ partId: null, description: '', quantity: 1, unitPriceCents: 1_000 }],
      payment: { kind: 'PAID', method: 'CASH' },
    });
    expect(avulso.success).toBe(false);
  });

  it('atendente vende mas não cancela; mecânico nem vende', () => {
    expect(can('ATTENDANT', 'counter_sales:sell')).toBe(true);
    expect(can('ATTENDANT', 'counter_sales:cancel')).toBe(false);
    expect(can('MECHANIC', 'counter_sales:sell')).toBe(false);
    expect(can('FINANCE', 'counter_sales:cancel')).toBe(true);
    expect(can('OWNER', 'counter_sales:cancel')).toBe(true);
  });
});
