import { describe, expect, it } from 'vitest';
import { montarDre, resultadoDaDre, type DreEntrada } from './dre';

const mes: DreEntrada = {
  receitaOsCents: 1_000_000,
  receitaBalcaoCents: 200_000,
  custoPecasCents: 400_000,
  despesas: [
    { name: 'Aluguel', systemKey: 'RENT', amountCents: 150_000 },
    { name: 'Impostos e taxas', systemKey: 'TAXES', amountCents: 72_000 },
    { name: 'Peças e insumos', systemKey: 'PARTS', amountCents: 380_000 },
    { name: 'Comissões dos mecânicos', systemKey: 'COMMISSIONS', amountCents: 90_000 },
    { name: 'Água, luz, internet', systemKey: 'UTILITIES', amountCents: 38_000 },
  ],
};

const valor = (key: string) => montarDre(mes).find((linha) => linha.key === key)!.amountCents;

describe('DRE (E49)', () => {
  it('desce da receita bruta ao resultado na ordem do contador', () => {
    expect(valor('receita_bruta')).toBe(1_200_000);
    expect(valor('impostos')).toBe(-72_000);
    expect(valor('receita_liquida')).toBe(1_128_000);
    expect(valor('custo_pecas')).toBe(-400_000);
    expect(valor('comissoes')).toBe(-90_000);
    expect(valor('lucro_bruto')).toBe(638_000);
    expect(valor('despesas_operacionais')).toBe(-188_000);
    expect(valor('resultado')).toBe(450_000);
  });

  it('a compra de peças NÃO entra: a peça já está no custo da peça vendida', () => {
    const labels = montarDre(mes).map((linha) => linha.label);
    expect(labels).not.toContain('Peças e insumos');
  });

  it('o resultado da DRE é o lucro estimado: um número só para lucro', () => {
    expect(valor('resultado')).toBe(resultadoDaDre(mes));
  });

  it('cada linha mostra o peso na receita bruta', () => {
    const resultado = montarDre(mes).find((linha) => linha.key === 'resultado')!;
    expect(resultado.shareBps).toBe(3_750); // 450 / 1200 = 37,5%
  });

  it('mês sem receita não divide por zero', () => {
    const vazio = montarDre({ receitaOsCents: 0, receitaBalcaoCents: 0, custoPecasCents: 0, despesas: [] });
    expect(vazio.every((linha) => linha.shareBps === 0)).toBe(true);
  });
});
