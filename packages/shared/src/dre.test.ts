import { describe, expect, it } from 'vitest';
import { compararMeses, montarDre, type DreSegmento } from './dre';

const mes: DreSegmento = {
  receitaServicosCents: 10_000_000,
  receitaPecasCents: 3_000_000,
  receitaBalcaoCents: 2_000_000,
  custoPecasCents: 3_000_000,
  comissoesCents: 1_000_000,
  despesas: [
    { name: 'Aluguel', amountCents: 500_000 },
    { name: 'Água, luz, internet', amountCents: 100_000 },
  ],
  outrasReceitas: [],
  impostosLancadosCents: 32_000,
  fiscal: {
    regime: 'LUCRO_PRESUMIDO',
    rbt12Cents: 0,
    issBps: 500,
    icmsBps: null,
    pecasComIcmsSt: true,
    dasMeiCents: null,
    fracaoDoMes: 1,
  },
};

const dre = (segmentos: DreSegmento[]) => montarDre(segmentos).lines;
const valor = (linhas: ReturnType<typeof dre>, key: string) => linhas.find((l) => l.key === key)?.amountCents;

describe('DRE por competência (E51)', () => {
  it('cada grupo vem com o total EM CIMA e os itens logo embaixo', () => {
    const linhas = dre([mes]);
    const i = linhas.findIndex((l) => l.key === 'receita_bruta');
    expect(linhas[i]!.kind).toBe('grupo');
    expect(linhas.slice(i + 1, i + 4).map((l) => [l.key, l.parent])).toEqual([
      ['receita_servicos', 'receita_bruta'],
      ['receita_pecas', 'receita_bruta'],
      ['receita_balcao', 'receita_bruta'],
    ]);
    // a sintética é a soma das analíticas, em todos os grupos
    for (const grupo of linhas.filter((l) => l.kind === 'grupo')) {
      const soma = linhas.filter((l) => l.parent === grupo.key).reduce((s, l) => s + l.amountCents, 0);
      expect(grupo.amountCents, grupo.label).toBe(soma);
    }
  });

  it('desce da receita ao lucro líquido com o imposto calculado do regime', () => {
    const linhas = dre([mes]);
    expect(valor(linhas, 'receita_bruta')).toBe(15_000_000);
    // Presumido: ISS 5% de 100 mil, PIS 0,65% e COFINS 3% de 150 mil, peça com ICMS-ST
    expect(valor(linhas, 'iss')).toBe(-500_000);
    expect(valor(linhas, 'pis')).toBe(-97_500);
    expect(valor(linhas, 'cofins')).toBe(-450_000);
    expect(valor(linhas, 'deducoes')).toBe(-1_047_500);
    expect(valor(linhas, 'receita_liquida')).toBe(13_952_500);
    expect(valor(linhas, 'custos')).toBe(-4_000_000);
    expect(valor(linhas, 'lucro_bruto')).toBe(9_952_500);
    expect(valor(linhas, 'despesas_operacionais')).toBe(-600_000);
    expect(valor(linhas, 'resultado_antes_ir')).toBe(9_352_500);
    // IRPJ: base 32% de 100 mil + 8% de 50 mil = 36 mil → 7 mil; CSLL: 38 mil × 9% = 3.420
    expect(valor(linhas, 'provisao_ir')).toBe(-1_042_000);
    expect(valor(linhas, 'lucro_liquido')).toBe(8_310_500);
  });

  it('só aparecem os impostos que existem no regime', () => {
    const presumido = dre([mes]).filter((l) => l.parent === 'deducoes').map((l) => l.key);
    expect(presumido).toEqual(['iss', 'icms', 'pis', 'cofins']);
    const simples = dre([{ ...mes, fiscal: { ...mes.fiscal, regime: 'SIMPLES_NACIONAL' } }])
      .filter((l) => l.parent === 'deducoes')
      .map((l) => l.key);
    expect(simples).toContain('cpp');
    const mei = dre([{ ...mes, fiscal: { ...mes.fiscal, regime: 'MEI', dasMeiCents: 8_000 } }]);
    expect(mei.filter((l) => l.parent === 'deducoes').map((l) => l.key)).toEqual(['das_mei']);
    expect(mei.some((l) => l.key === 'provisao_ir'), 'MEI não tem IRPJ/CSLL').toBe(false);
  });

  it('o imposto é calculado mês a mês e só depois somado (o adicional do IRPJ é por mês)', () => {
    // dois meses iguais: o adicional incide em cada um. Calcular sobre a soma daria outro número.
    const doisMeses = dre([mes, mes]);
    expect(valor(doisMeses, 'irpj')).toBe(2 * valor(dre([mes]), 'irpj')!);
  });

  it('Lucro Real: IRPJ e CSLL saem do resultado antes do IR', () => {
    const real = dre([{ ...mes, fiscal: { ...mes.fiscal, regime: 'LUCRO_REAL' } }]);
    const antes = valor(real, 'resultado_antes_ir')!;
    expect(valor(real, 'csll')).toBe(-Math.round(antes * 0.09));
  });

  it('outras receitas só aparecem quando existem', () => {
    expect(dre([mes]).some((l) => l.key === 'outras_receitas')).toBe(false);
    const com = dre([{ ...mes, outrasReceitas: [{ name: 'Aluguel de box', amountCents: 50_000 }] }]);
    expect(valor(com, 'outras_receitas')).toBe(50_000);
    expect(valor(com, 'resultado_antes_ir')).toBe(valor(com, 'resultado_operacional')! + 50_000);
  });

  it('a guia de imposto lançada não dobra o imposto calculado; sem regime, ela é o imposto da DRE', () => {
    const comRegime = dre([mes]);
    expect(comRegime.some((l) => l.key === 'impostos_lancados')).toBe(false);
    expect(valor(comRegime, 'deducoes')).toBe(-1_047_500);
    const semRegime = dre([{ ...mes, fiscal: { ...mes.fiscal, regime: null } }]);
    expect(valor(semRegime, 'impostos_lancados')).toBe(-32_000);
    expect(valor(semRegime, 'deducoes')).toBe(-32_000);
  });

  it('mês sem receita não divide por zero', () => {
    const vazio = dre([
      { ...mes, receitaServicosCents: 0, receitaPecasCents: 0, receitaBalcaoCents: 0, custoPecasCents: 0, comissoesCents: 0, despesas: [] },
    ]);
    expect(vazio.every((l) => l.shareBps === 0)).toBe(true);
  });
});

describe('DRE de vários meses lado a lado (exportação)', () => {
  const fevereiro: DreSegmento = {
    ...mes,
    receitaServicosCents: 4_000_000,
    despesas: [
      { name: 'Aluguel', amountCents: 500_000 },
      { name: 'Contador', amountCents: 80_000 },
    ],
  };
  const comparada = compararMeses([
    { mes: '2026-01', segmentos: [mes] },
    { mes: '2026-02', segmentos: [fevereiro] },
  ]);
  const linha = (key: string) => comparada.linhas.find((l) => l.key === key)!;

  it('todos os meses têm as mesmas linhas; a despesa que não houve no mês aparece zerada', () => {
    expect(comparada.meses).toEqual(['2026-01', '2026-02']);
    expect(linha('despesa:Contador').valores).toEqual([0, -80_000]);
    expect(linha('despesa:Água, luz, internet').valores).toEqual([-100_000, 0]);
  });

  it('cada mês bate com a DRE daquele mês sozinho, e o total é a soma dos meses', () => {
    const soJaneiro = new Map(montarDre([mes]).lines.map((l) => [l.key, l.amountCents]));
    const soFevereiro = new Map(montarDre([fevereiro]).lines.map((l) => [l.key, l.amountCents]));
    for (const l of comparada.linhas) {
      expect(l.valores, l.key).toEqual([soJaneiro.get(l.key) ?? 0, soFevereiro.get(l.key) ?? 0]);
      expect(l.amountCents, l.key).toBe(l.valores[0]! + l.valores[1]!);
    }
  });

  it('cada linha "(=)" diz quais linhas soma, e a soma bate (é daqui que sai a fórmula do Excel)', () => {
    const resultados = comparada.linhas.filter((l) => l.kind === 'resultado');
    expect(resultados.map((l) => l.key)).toEqual([
      'receita_liquida',
      'lucro_bruto',
      'resultado_operacional',
      'resultado_antes_ir',
      'lucro_liquido',
    ]);
    for (const r of resultados) {
      for (const [i] of comparada.meses.entries()) {
        const soma = r.compoe!.reduce((t, k) => t + linha(k).valores[i]!, 0);
        expect(r.valores[i], `${r.key} no mês ${i}`).toBe(soma);
      }
    }
  });
});
