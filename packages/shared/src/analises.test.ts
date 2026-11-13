import { describe, expect, it } from 'vitest';
import { analisesQuerySchema, diasDeEstoqueDaPeca, giroDeEstoque, porHora, taxaBps, variacaoBps } from './analises';

describe('análises: as contas', () => {
  it('taxa e variação em basis points, sem dividir por zero', () => {
    expect(taxaBps(3, 12)).toBe(2500);
    expect(taxaBps(0, 0)).toBeNull();
    expect(variacaoBps(120, 100)).toBe(2000);
    expect(variacaoBps(80, 100)).toBe(-2000);
    // lucro que sai do prejuízo: a base negativa não inverte o sinal
    expect(variacaoBps(-50, -100)).toBe(5000);
    expect(variacaoBps(10, 0)).toBeNull();
  });

  it('giro = custo do que saiu ÷ estoque médio; cobertura = estoque final ÷ saída por dia', () => {
    // saiu R$ 3.000 em 30 dias, estoque foi de R$ 2.000 para R$ 4.000 (médio 3.000)
    expect(giroDeEstoque({ custoSaidasCents: 300_000, inicialCents: 200_000, finalCents: 400_000, dias: 30 })).toEqual({
      giroCentesimos: 100,
      // sai R$ 100/dia; R$ 4.000 dá para 40 dias
      diasDeEstoque: 40,
    });
    // estoque parado, nada saiu: giro zero, cobertura desconhecida
    expect(giroDeEstoque({ custoSaidasCents: 0, inicialCents: 100, finalCents: 100, dias: 30 })).toEqual({
      giroCentesimos: 0,
      diasDeEstoque: null,
    });
    // sem estoque nenhum: não há giro a calcular
    expect(giroDeEstoque({ custoSaidasCents: 0, inicialCents: 0, finalCents: 0, dias: 30 }).giroCentesimos).toBeNull();
  });

  it('dias de estoque da peça e lucro por hora', () => {
    // 9 saíram em 90 dias (1 a cada 10), sobraram 4: dá para 40 dias
    expect(diasDeEstoqueDaPeca(4, 9, 90)).toBe(40);
    expect(diasDeEstoqueDaPeca(-2, 9, 90)).toBe(0);
    expect(diasDeEstoqueDaPeca(null, 9, 90)).toBeNull();
    expect(diasDeEstoqueDaPeca(4, 0, 90)).toBeNull();
    // R$ 150 em 90 minutos = R$ 100 por hora
    expect(porHora(15_000, 90)).toBe(10_000);
    expect(porHora(15_000, 0)).toBeNull();
  });

  it('a janela só aceita 1, 3, 6 ou 12 meses (3 se não vier)', () => {
    expect(analisesQuerySchema.parse({}).meses).toBe(3);
    expect(analisesQuerySchema.parse({ meses: '12' }).meses).toBe(12);
    expect(analisesQuerySchema.safeParse({ meses: '5' }).success).toBe(false);
  });
});
