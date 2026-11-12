import type { TaxRegime } from './enums/fiscal';

/**
 * Os impostos da DRE (E51), CALCULADOS sobre o faturamento do mês pela regra
 * do regime da oficina, e não somados do que ela lançou como pago. É o que o
 * contador faz: a DRE por competência mostra o imposto que o faturamento do
 * mês gerou, mesmo que a guia vença no mês seguinte.
 *
 * O que é aproximação, e está escrito na tela:
 * - Simples: a alíquota efetiva usa a receita dos 12 meses anteriores que o
 *   sistema conhece (com menos de 12 meses, a média anualizada, que é a regra
 *   da LC 123 para empresa em início de atividade).
 * - Lucro Real: o crédito de PIS/COFINS sai do custo das peças vendidas no mês,
 *   não da nota de compra; IRPJ e CSLL são provisão mensal sobre o lucro do mês.
 * - O adicional de 10% do IRPJ usa o limite mensal (R$ 20 mil), proporcional
 *   aos dias quando o período não é o mês inteiro.
 */

/** Uma faixa do Simples: até quanto de RBT12, alíquota nominal, parcela a deduzir e a repartição. */
interface FaixaSimples {
  ateCents: number;
  aliquota: number;
  deduzirCents: number;
  /** percentual de cada tributo dentro do DAS (soma 100) */
  reparticao: Partial<Record<TributoSimples, number>>;
}

export const TRIBUTOS_SIMPLES = ['irpj', 'csll', 'cofins', 'pis', 'cpp', 'icms', 'iss'] as const;
export type TributoSimples = (typeof TRIBUTOS_SIMPLES)[number];

const MIL = 100_000; // R$ 1.000,00 em centavos

/** Anexo I (comércio): a peça vendida. LC 123/2006, redação da LC 155/2016. */
export const ANEXO_I: readonly FaixaSimples[] = [
  { ateCents: 180 * MIL, aliquota: 4.0, deduzirCents: 0, reparticao: { irpj: 5.5, csll: 3.5, cofins: 12.74, pis: 2.76, cpp: 41.5, icms: 34 } },
  { ateCents: 360 * MIL, aliquota: 7.3, deduzirCents: 5_940_00, reparticao: { irpj: 5.5, csll: 3.5, cofins: 12.74, pis: 2.76, cpp: 41.5, icms: 34 } },
  { ateCents: 720 * MIL, aliquota: 9.5, deduzirCents: 13_860_00, reparticao: { irpj: 5.5, csll: 3.5, cofins: 12.74, pis: 2.76, cpp: 42, icms: 33.5 } },
  { ateCents: 1_800 * MIL, aliquota: 10.7, deduzirCents: 22_500_00, reparticao: { irpj: 5.5, csll: 3.5, cofins: 12.74, pis: 2.76, cpp: 42, icms: 33.5 } },
  { ateCents: 3_600 * MIL, aliquota: 14.3, deduzirCents: 87_300_00, reparticao: { irpj: 5.5, csll: 3.5, cofins: 12.74, pis: 2.76, cpp: 42, icms: 33.5 } },
  { ateCents: 4_800 * MIL, aliquota: 19.0, deduzirCents: 378_000_00, reparticao: { irpj: 13.5, csll: 10, cofins: 28.27, pis: 6.13, cpp: 42.1 } },
];

/** Anexo III (serviços): manutenção e reparação de veículos (CNAE 4520). */
export const ANEXO_III: readonly FaixaSimples[] = [
  { ateCents: 180 * MIL, aliquota: 6.0, deduzirCents: 0, reparticao: { irpj: 4, csll: 3.5, cofins: 12.82, pis: 2.78, cpp: 43.4, iss: 33.5 } },
  { ateCents: 360 * MIL, aliquota: 11.2, deduzirCents: 9_360_00, reparticao: { irpj: 4, csll: 3.5, cofins: 14.05, pis: 3.05, cpp: 43.4, iss: 32 } },
  { ateCents: 720 * MIL, aliquota: 13.5, deduzirCents: 17_640_00, reparticao: { irpj: 4, csll: 3.5, cofins: 13.64, pis: 2.96, cpp: 43.4, iss: 32.5 } },
  { ateCents: 1_800 * MIL, aliquota: 16.0, deduzirCents: 35_640_00, reparticao: { irpj: 4, csll: 3.5, cofins: 13.64, pis: 2.96, cpp: 43.4, iss: 32.5 } },
  { ateCents: 3_600 * MIL, aliquota: 21.0, deduzirCents: 125_640_00, reparticao: { irpj: 4, csll: 3.5, cofins: 12.82, pis: 2.78, cpp: 43.4, iss: 33.5 } },
  { ateCents: 4_800 * MIL, aliquota: 33.0, deduzirCents: 648_000_00, reparticao: { irpj: 35, csll: 15, cofins: 16.03, pis: 3.47, cpp: 30.5 } },
];

/** Acima de R$ 4,8 milhões a empresa sai do Simples; a conta usa a última faixa. */
function faixaDo(anexo: readonly FaixaSimples[], rbt12Cents: number): { faixa: FaixaSimples; numero: number } {
  const indice = anexo.findIndex((faixa) => rbt12Cents <= faixa.ateCents);
  const numero = indice === -1 ? anexo.length : indice + 1;
  return { faixa: anexo[numero - 1]!, numero };
}

/**
 * Alíquota efetiva, em percentual: (RBT12 × nominal − parcela a deduzir) ÷ RBT12.
 * Sem receita anterior (primeiro mês), vale a nominal da primeira faixa.
 */
export function aliquotaEfetivaSimples(anexo: readonly FaixaSimples[], rbt12Cents: number): number {
  if (rbt12Cents <= 0) return anexo[0]!.aliquota;
  const { faixa } = faixaDo(anexo, rbt12Cents);
  return ((rbt12Cents * faixa.aliquota) / 100 - faixa.deduzirCents) / rbt12Cents * 100;
}

export interface ImpostosCalculados {
  iss: number;
  icms: number;
  pis: number;
  cofins: number;
  /** INSS patronal que vai dentro do DAS (só no Simples) */
  cpp: number;
  /** DAS fixo do MEI */
  dasMei: number;
  irpj: number;
  csll: number;
}

export const ZERO_IMPOSTOS: ImpostosCalculados = { iss: 0, icms: 0, pis: 0, cofins: 0, cpp: 0, dasMei: 0, irpj: 0, csll: 0 };

export interface EntradaImpostos {
  regime: TaxRegime | null;
  /** receita bruta do mês por competência, em centavos */
  servicosCents: number;
  pecasCents: number;
  /** Simples: receita bruta dos 12 meses anteriores ao mês */
  rbt12Cents: number;
  /** alíquota do ISS do município; null = a oficina ainda não informou */
  issBps: number | null;
  /** alíquota de ICMS da peça fora do Simples; ignorada quando a peça tem ICMS-ST */
  icmsBps: number | null;
  /** a peça já veio com o ICMS retido na compra (substituição tributária): a revenda não paga de novo */
  pecasComIcmsSt: boolean;
  /** Lucro Real: custo das peças vendidas, base do crédito de PIS/COFINS */
  custoPecasCents: number;
  /** MEI: valor do DAS mensal */
  dasMeiCents: number | null;
  /** fração do mês que o período cobre (1 = mês inteiro): DAS-MEI e limite do adicional do IRPJ */
  fracaoDoMes: number;
}

export interface DetalheSimples {
  anexo: 'I' | 'III';
  faixa: number;
  /** alíquota efetiva em basis points (1234 = 12,34%) */
  efetivaBps: number;
}

export interface ResultadoImpostos {
  impostos: ImpostosCalculados;
  /** só no Simples: a faixa e a efetiva de cada anexo usado */
  simples: DetalheSimples[];
  avisos: string[];
}

const centavos = (valor: number) => Math.round(valor);
const porBps = (base: number, bps: number) => centavos((base * bps) / 10_000);

/** O DAS de uma atividade, repartido entre os tributos (com o teto de 5% do ISS). */
function dasDoAnexo(
  anexo: readonly FaixaSimples[],
  receitaCents: number,
  rbt12Cents: number,
  tirarIcms: boolean,
): { partes: Record<TributoSimples, number>; detalhe: DetalheSimples; nomeAnexo: 'I' | 'III' } {
  const efetiva = aliquotaEfetivaSimples(anexo, rbt12Cents);
  const { faixa, numero } = rbt12Cents <= 0 ? { faixa: anexo[0]!, numero: 1 } : faixaDo(anexo, rbt12Cents);
  const percentuais: Record<TributoSimples, number> = { irpj: 0, csll: 0, cofins: 0, pis: 0, cpp: 0, icms: 0, iss: 0 };
  for (const tributo of TRIBUTOS_SIMPLES) percentuais[tributo] = faixa.reparticao[tributo] ?? 0;

  // Anexo III, 5ª faixa: o ISS dentro do DAS não passa de 5% da receita; o que
  // passar é redistribuído entre os outros tributos na mesma proporção (LC 123, art. 18, §§ 5º-F e 5º-G).
  if (percentuais.iss > 0 && (efetiva * percentuais.iss) / 100 > 5) {
    const issMaximo = (5 / efetiva) * 100;
    const sobra = percentuais.iss - issMaximo;
    const outros = (['irpj', 'csll', 'cofins', 'pis', 'cpp'] as const).reduce((s, t) => s + percentuais[t], 0);
    for (const t of ['irpj', 'csll', 'cofins', 'pis', 'cpp'] as const) percentuais[t] += (sobra * percentuais[t]) / outros;
    percentuais.iss = issMaximo;
  }

  const partes: Record<TributoSimples, number> = { irpj: 0, csll: 0, cofins: 0, pis: 0, cpp: 0, icms: 0, iss: 0 };
  for (const tributo of TRIBUTOS_SIMPLES) {
    if (tributo === 'icms' && tirarIcms) continue; // ICMS-ST: a parcela do ICMS sai do DAS
    partes[tributo] = centavos((receitaCents * efetiva * percentuais[tributo]) / 10_000);
  }
  const nomeAnexo = anexo === ANEXO_I ? 'I' : 'III';
  return { partes, nomeAnexo, detalhe: { anexo: nomeAnexo, faixa: numero, efetivaBps: Math.round(efetiva * 100) } };
}

/**
 * Os tributos que nascem do FATURAMENTO: tudo do Simples e do MEI, e no
 * Presumido também IRPJ e CSLL (que lá saem de uma presunção sobre a receita).
 * No Lucro Real, IRPJ e CSLL dependem do lucro: ver `irpjCsllLucroReal`.
 */
export function impostosSobreFaturamento(e: EntradaImpostos): ResultadoImpostos {
  const avisos: string[] = [];
  const receita = e.servicosCents + e.pecasCents;
  const iss = (base: number) => {
    if (e.issBps === null) {
      if (base > 0) avisos.push('Falta a alíquota de ISS do município nas configurações fiscais: o ISS ficou zerado.');
      return 0;
    }
    return porBps(base, e.issBps);
  };
  const icms = (base: number) => {
    if (e.pecasComIcmsSt) return 0;
    if (e.icmsBps === null) {
      if (base > 0) avisos.push('Falta a alíquota de ICMS das peças nas configurações fiscais: o ICMS ficou zerado.');
      return 0;
    }
    return porBps(base, e.icmsBps);
  };

  switch (e.regime) {
    case null:
      return { impostos: { ...ZERO_IMPOSTOS }, simples: [], avisos: ['O regime tributário não foi informado: a DRE está sem impostos.'] };

    case 'MEI': {
      if (e.dasMeiCents === null) avisos.push('Informe o valor do DAS-MEI nas configurações fiscais.');
      const dasMei = receita > 0 || e.fracaoDoMes > 0 ? centavos((e.dasMeiCents ?? 0) * e.fracaoDoMes) : 0;
      return { impostos: { ...ZERO_IMPOSTOS, dasMei }, simples: [], avisos };
    }

    case 'SIMPLES_NACIONAL': {
      const total: ImpostosCalculados = { ...ZERO_IMPOSTOS };
      const simples: DetalheSimples[] = [];
      if (e.rbt12Cents > ANEXO_III.at(-1)!.ateCents) {
        avisos.push('A receita dos últimos 12 meses passou de R$ 4,8 milhões, o teto do Simples: confira o regime com o contador.');
      }
      // acima do sublimite de R$ 3,6 milhões, ICMS e ISS saem do DAS e são pagos por fora
      const foraDoSublimite = e.rbt12Cents > 3_600 * MIL;
      for (const [anexo, base] of [
        [ANEXO_III, e.servicosCents],
        [ANEXO_I, e.pecasCents],
      ] as const) {
        if (base <= 0) continue;
        const { partes, detalhe } = dasDoAnexo(anexo, base, e.rbt12Cents, e.pecasComIcmsSt);
        simples.push(detalhe);
        total.irpj += partes.irpj;
        total.csll += partes.csll;
        total.cofins += partes.cofins;
        total.pis += partes.pis;
        total.cpp += partes.cpp;
        total.iss += partes.iss;
        total.icms += partes.icms;
      }
      if (foraDoSublimite) {
        total.iss += iss(e.servicosCents);
        total.icms += icms(e.pecasCents);
      }
      return { impostos: total, simples, avisos };
    }

    case 'LUCRO_PRESUMIDO': {
      // presunção: 32% do serviço e 8% da revenda para o IRPJ; 32% e 12% para a CSLL
      const baseIrpj = e.servicosCents * 0.32 + e.pecasCents * 0.08;
      const baseCsll = e.servicosCents * 0.32 + e.pecasCents * 0.12;
      return {
        impostos: {
          ...ZERO_IMPOSTOS,
          iss: iss(e.servicosCents),
          icms: icms(e.pecasCents),
          pis: porBps(receita, 65),
          cofins: porBps(receita, 300),
          irpj: irpjComAdicional(baseIrpj, e.fracaoDoMes),
          csll: centavos(baseCsll * 0.09),
        },
        simples: [],
        avisos,
      };
    }

    case 'LUCRO_REAL': {
      // não cumulativo: 1,65% e 7,6% sobre a receita, com crédito sobre o custo da peça vendida
      const pis = Math.max(0, porBps(receita, 165) - porBps(e.custoPecasCents, 165));
      const cofins = Math.max(0, porBps(receita, 760) - porBps(e.custoPecasCents, 760));
      return {
        impostos: { ...ZERO_IMPOSTOS, iss: iss(e.servicosCents), icms: icms(e.pecasCents), pis, cofins },
        simples: [],
        avisos,
      };
    }
  }
}

/** IRPJ de 15%, mais 10% sobre o que passar de R$ 20 mil no mês (proporcional ao período). */
function irpjComAdicional(baseCents: number, fracaoDoMes: number): number {
  if (baseCents <= 0) return 0;
  const limite = 20 * MIL * fracaoDoMes;
  return centavos(baseCents * 0.15 + Math.max(0, baseCents - limite) * 0.1);
}

/** Lucro Real: IRPJ e CSLL sobre o lucro do período; prejuízo não gera imposto. */
export function irpjCsllLucroReal(lucroAntesCents: number, fracaoDoMes: number): { irpj: number; csll: number } {
  if (lucroAntesCents <= 0) return { irpj: 0, csll: 0 };
  return { irpj: irpjComAdicional(lucroAntesCents, fracaoDoMes), csll: centavos(lucroAntesCents * 0.09) };
}
