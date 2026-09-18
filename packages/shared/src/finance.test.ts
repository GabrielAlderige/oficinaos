import { describe, expect, it } from 'vitest';
import {
  diasDeAtraso,
  distribuirPagamento,
  dividirEmParcelas,
  faltaCents,
  lucroEstimado,
  situacaoDoLancamento,
  statusDoLancamento,
  vencimentosMensais,
} from './finance';

describe('situação do lançamento', () => {
  it('sem baixa é em aberto; com parte, parcial; coberto, quitado', () => {
    expect(statusDoLancamento(0, 10_000)).toBe('OPEN');
    expect(statusDoLancamento(1, 10_000)).toBe('PARTIAL');
    expect(statusDoLancamento(9_999, 10_000)).toBe('PARTIAL');
    expect(statusDoLancamento(10_000, 10_000)).toBe('PAID');
  });

  it('valor zero nunca fica quitado sozinho', () => {
    expect(statusDoLancamento(0, 0)).toBe('OPEN');
  });

  it('o que falta nunca é negativo', () => {
    expect(faltaCents({ amountCents: 10_000, paidCents: 12_000 })).toBe(0);
    expect(faltaCents({ amountCents: 10_000, paidCents: 2_500 })).toBe(7_500);
  });

  it('venceu ontem e falta dinheiro: vencida', () => {
    expect(situacaoDoLancamento({ status: 'OPEN', dueDate: '2026-09-17' }, '2026-09-18')).toBe('OVERDUE');
    expect(situacaoDoLancamento({ status: 'PARTIAL', dueDate: '2026-09-17' }, '2026-09-18')).toBe('OVERDUE');
  });

  it('vence hoje ainda não está vencida', () => {
    expect(situacaoDoLancamento({ status: 'OPEN', dueDate: '2026-09-18' }, '2026-09-18')).toBe('OPEN');
  });

  it('quitada e cancelada não vencem, mesmo com a data no passado', () => {
    expect(situacaoDoLancamento({ status: 'PAID', dueDate: '2020-01-01' }, '2026-09-18')).toBe('PAID');
    expect(situacaoDoLancamento({ status: 'CANCELED', dueDate: '2020-01-01' }, '2026-09-18')).toBe('CANCELED');
  });

  it('conta os dias de atraso sem tropeçar na virada do mês', () => {
    expect(diasDeAtraso('2026-09-18', '2026-09-18')).toBe(0);
    expect(diasDeAtraso('2026-09-30', '2026-10-02')).toBe(2);
    expect(diasDeAtraso('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe('parcelamento', () => {
  it('não perde centavo: a sobra vai para a primeira parcela', () => {
    expect(dividirEmParcelas(90_001, 3)).toEqual([30_001, 30_000, 30_000]);
    expect(dividirEmParcelas(10_000, 3).reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it('uma parcela é o valor inteiro', () => {
    expect(dividirEmParcelas(1_234, 1)).toEqual([1_234]);
  });

  it('recusa parcela sem centavo e quantidade inválida', () => {
    expect(() => dividirEmParcelas(2, 3)).toThrow(RangeError);
    expect(() => dividirEmParcelas(100, 0)).toThrow(RangeError);
  });

  it('os vencimentos são mensais e prendem no último dia do mês', () => {
    expect(vencimentosMensais('2026-01-31', 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
});

describe('distribuição do pagamento entre parcelas', () => {
  const parcelas = [{ amountCents: 30_000 }, { amountCents: 30_000 }, { amountCents: 30_000 }];

  it('quita da mais velha para a mais nova', () => {
    expect(distribuirPagamento(45_000, parcelas)).toEqual([30_000, 15_000, 0]);
  });

  it('pagamento nenhum não cobre nada', () => {
    expect(distribuirPagamento(0, parcelas)).toEqual([0, 0, 0]);
  });

  it('o que passa do total não vira crédito em parcela nenhuma', () => {
    expect(distribuirPagamento(200_000, parcelas)).toEqual([30_000, 30_000, 30_000]);
  });
});

describe('lucro estimado', () => {
  it('receita menos peças menos despesas, com a margem em basis points', () => {
    const resultado = lucroEstimado({ receitaCents: 100_000, custoPecasCents: 40_000, despesasCents: 10_000 });
    expect(resultado.lucroCents).toBe(50_000);
    expect(resultado.margemBps).toBe(5_000);
  });

  it('prejuízo aparece como lucro negativo, não como zero', () => {
    const resultado = lucroEstimado({ receitaCents: 10_000, custoPecasCents: 8_000, despesasCents: 5_000 });
    expect(resultado.lucroCents).toBe(-3_000);
    expect(resultado.margemBps).toBe(-3_000);
  });

  it('sem receita a margem é zero, e não uma divisão por zero', () => {
    expect(lucroEstimado({ receitaCents: 0, custoPecasCents: 0, despesasCents: 5_000 }).margemBps).toBe(0);
  });
});
