import { z } from 'zod';
import { TAX_REGIME_SOURCES, TAX_REGIMES, type TaxRegime } from './enums/fiscal';
import { impostosSobreFaturamento, irpjCsllLucroReal, type DetalheSimples, type EntradaImpostos } from './impostos';

/**
 * DRE da oficina (E51), do jeito que o contador lê: cada GRUPO (sintética)
 * com o total em cima e os itens (analíticas) embaixo, por COMPETÊNCIA:
 *
 * - receita: a OS entra no mês em que foi finalizada, a venda de balcão no dia
 *   da venda — não quando o dinheiro caiu;
 * - impostos: CALCULADOS sobre essa receita pela regra do regime (`impostos.ts`);
 * - custo: a peça pelo custo médio da hora em que saiu do estoque, e a comissão
 *   da OS finalizada no mês (não a do dia em que o mecânico recebeu);
 * - despesa: pela competência do lançamento (sem competência, o vencimento).
 *
 * Não tem plano de contas nem numeração: as linhas são fixas e as despesas
 * vêm das categorias da oficina. "Peças e insumos" pagos ficam de fora: a peça
 * já entrou pelo custo da que saiu, e contar a compra descontaria duas vezes.
 */

/** Os números de um pedaço do período (um mês, ou parte dele) — o que vem do banco. */
export interface DreSegmento {
  receitaServicosCents: number;
  receitaPecasCents: number;
  receitaBalcaoCents: number;
  custoPecasCents: number;
  comissoesCents: number;
  /** despesas por categoria, sem "Peças e insumos" nem a guia de impostos */
  despesas: { name: string; amountCents: number }[];
  /**
   * A guia de imposto sobre o faturamento lançada (categoria "Impostos"). Com
   * regime, o imposto é CALCULADO e ela fica fora (seria o mesmo imposto duas
   * vezes); sem regime, é o único imposto que se conhece e vai para as deduções.
   */
  impostosLancadosCents: number;
  /** receitas que não são OS nem balcão (lançamentos avulsos a receber) */
  outrasReceitas: { name: string; amountCents: number }[];
  /** o que os impostos precisam além da receita */
  fiscal: Omit<EntradaImpostos, 'servicosCents' | 'pecasCents' | 'custoPecasCents'>;
}

export const DRE_LINE_KINDS = ['grupo', 'item', 'resultado'] as const;
export type DreLineKind = (typeof DRE_LINE_KINDS)[number];

export const dreLineSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** grupo = sintética (soma dos itens, vem em cima); item = analítica; resultado = linha "(=)" */
  kind: z.enum(DRE_LINE_KINDS),
  /** o grupo a que o item pertence */
  parent: z.string().nullable(),
  /** com sinal: dedução, custo e despesa são negativos */
  amountCents: z.number().int(),
  /** fração da receita bruta, em basis points (1250 = 12,5%) */
  shareBps: z.number().int(),
});
export type DreLine = z.infer<typeof dreLineSchema>;

const bps = (valor: number, base: number) => (base > 0 ? Math.round((valor / base) * 10_000) : 0);

/** Os itens de imposto que cada regime mostra (os outros não existem para ele). */
const DEDUCOES_DO_REGIME: Record<TaxRegime | 'NONE', string[]> = {
  NONE: ['impostos_lancados'],
  MEI: ['das_mei'],
  SIMPLES_NACIONAL: ['iss', 'icms', 'pis', 'cofins', 'cpp'],
  LUCRO_PRESUMIDO: ['iss', 'icms', 'pis', 'cofins'],
  LUCRO_REAL: ['iss', 'icms', 'pis', 'cofins'],
};
const ROTULO_IMPOSTO: Record<string, string> = {
  iss: 'ISS',
  icms: 'ICMS',
  pis: 'PIS',
  cofins: 'COFINS',
  cpp: 'INSS patronal (CPP, dentro do DAS)',
  das_mei: 'DAS-MEI',
  impostos_lancados: 'Impostos lançados (sem regime, não calculados)',
  irpj: 'IRPJ',
  csll: 'CSLL',
};

/** Os valores de um segmento, por chave de linha, já com o imposto calculado. */
function valoresDoSegmento(s: DreSegmento): { valores: Map<string, number>; simples: DetalheSimples[]; avisos: string[] } {
  const v = new Map<string, number>();
  const somar = (chave: string, valor: number) => v.set(chave, (v.get(chave) ?? 0) + valor);

  const pecasCents = s.receitaPecasCents + s.receitaBalcaoCents;
  const { impostos, simples, avisos } = impostosSobreFaturamento({
    ...s.fiscal,
    servicosCents: s.receitaServicosCents,
    pecasCents,
    custoPecasCents: s.custoPecasCents,
  });

  somar('receita_servicos', s.receitaServicosCents);
  somar('receita_pecas', s.receitaPecasCents);
  somar('receita_balcao', s.receitaBalcaoCents);
  for (const chave of ['iss', 'icms', 'pis', 'cofins', 'cpp'] as const) somar(chave, -impostos[chave]);
  somar('das_mei', -impostos.dasMei);
  const lancados = s.fiscal.regime === null ? s.impostosLancadosCents : 0;
  somar('impostos_lancados', -lancados);
  somar('custo_pecas', -s.custoPecasCents);
  somar('comissoes', -s.comissoesCents);
  for (const d of s.despesas) somar(`despesa:${d.name}`, -d.amountCents);
  for (const r of s.outrasReceitas) somar(`outra:${r.name}`, r.amountCents);

  const bruta = s.receitaServicosCents + pecasCents;
  const deducoes = impostos.iss + impostos.icms + impostos.pis + impostos.cofins + impostos.cpp + impostos.dasMei + lancados;
  const despesas = s.despesas.reduce((t, d) => t + d.amountCents, 0);
  const outras = s.outrasReceitas.reduce((t, r) => t + r.amountCents, 0);
  const antesIr = bruta - deducoes - s.custoPecasCents - s.comissoesCents - despesas + outras;

  const ir = s.fiscal.regime === 'LUCRO_REAL' ? irpjCsllLucroReal(antesIr, s.fiscal.fracaoDoMes) : impostos;
  somar('irpj', -ir.irpj);
  somar('csll', -ir.csll);
  return { valores: v, simples, avisos };
}

export interface DreMontada {
  lines: DreLine[];
  simples: DetalheSimples[];
  avisos: string[];
}

/**
 * As linhas da DRE, na ordem, somando os segmentos do período. O imposto é
 * calculado SEGMENTO A SEGMENTO (cada mês tem a sua faixa do Simples e o seu
 * limite do adicional do IRPJ) e só depois somado.
 */
export function montarDre(segmentos: DreSegmento[]): DreMontada {
  const total = new Map<string, number>();
  // a faixa do Simples que a tela mostra é a do último mês do período
  let simples: DetalheSimples[] = [];
  const avisos = new Set<string>();
  for (const s of segmentos) {
    const r = valoresDoSegmento(s);
    for (const [chave, valor] of r.valores) total.set(chave, (total.get(chave) ?? 0) + valor);
    if (r.simples.length) simples = r.simples;
    for (const aviso of r.avisos) avisos.add(aviso);
  }
  const regime = segmentos.at(-1)?.fiscal.regime ?? null;
  const val = (chave: string) => total.get(chave) ?? 0;
  const chavesCom = (prefixo: string) =>
    [...total.keys()].filter((k) => k.startsWith(prefixo)).sort((a, b) => val(a) - val(b) || a.localeCompare(b));

  const bruta = val('receita_servicos') + val('receita_pecas') + val('receita_balcao');
  const linhas: DreLine[] = [];
  const linha = (key: string, label: string, kind: DreLineKind, parent: string | null, amountCents: number) =>
    linhas.push({ key, label, kind, parent, amountCents, shareBps: bps(amountCents, bruta) });
  /** grupo com o total EM CIMA e os itens embaixo */
  const grupo = (key: string, label: string, itens: [string, string][]) => {
    const soma = itens.reduce((t, [k]) => t + val(k), 0);
    linha(key, label, 'grupo', null, soma);
    for (const [k, rotulo] of itens) linha(k, rotulo, 'item', key, val(k));
    return soma;
  };

  const receitaBruta = grupo('receita_bruta', 'Receita bruta', [
    ['receita_servicos', 'Serviços (mão de obra)'],
    ['receita_pecas', 'Peças aplicadas nas OS'],
    ['receita_balcao', 'Venda de balcão'],
  ]);
  const deducoes = grupo(
    'deducoes',
    '(-) Deduções da receita',
    DEDUCOES_DO_REGIME[regime ?? 'NONE'].map((k) => [k, ROTULO_IMPOSTO[k]!]),
  );
  const liquida = receitaBruta + deducoes;
  linha('receita_liquida', '(=) Receita operacional líquida', 'resultado', null, liquida);

  const custos = grupo('custos', '(-) Custo dos serviços e peças', [
    ['custo_pecas', 'Custo das peças vendidas'],
    ['comissoes', 'Comissões dos mecânicos'],
  ]);
  const lucroBruto = liquida + custos;
  linha('lucro_bruto', '(=) Lucro bruto', 'resultado', null, lucroBruto);

  const despesas = grupo(
    'despesas_operacionais',
    '(-) Despesas operacionais',
    chavesCom('despesa:').map((k) => [k, k.slice('despesa:'.length)]),
  );
  const operacional = lucroBruto + despesas;
  linha('resultado_operacional', '(=) Resultado operacional', 'resultado', null, operacional);

  const extras = chavesCom('outra:');
  const outras = extras.length
    ? grupo(
        'outras_receitas',
        '(+) Outras receitas',
        extras.map((k) => [k, k.slice('outra:'.length)]),
      )
    : 0;
  const antesIr = operacional + outras;
  linha('resultado_antes_ir', '(=) Resultado antes do IRPJ e CSLL', 'resultado', null, antesIr);

  const provisao =
    regime && regime !== 'MEI'
      ? grupo('provisao_ir', '(-) Provisão para IRPJ e CSLL', [
          ['irpj', 'IRPJ'],
          ['csll', 'CSLL'],
        ])
      : 0;
  linha('lucro_liquido', '(=) Lucro líquido do período', 'resultado', null, antesIr + provisao);

  return { lines: linhas, simples, avisos: [...avisos] };
}

// ------------------------------ resposta da API ------------------------------

export const dreRegimeSchema = z.object({
  regime: z.enum(TAX_REGIMES).nullable(),
  /** de onde veio: consulta à Receita pelo CNPJ ou escolha da oficina */
  source: z.enum(TAX_REGIME_SOURCES).nullable(),
  /** o que a Receita disse, para a tela mostrar ("Lucro Presumido em 2024") */
  detail: z.string().nullable(),
  checkedAt: z.string().nullable(),
  simples: z.array(z.object({ anexo: z.enum(['I', 'III']), faixa: z.number().int(), efetivaBps: z.number().int() })),
  avisos: z.array(z.string()),
});
export type DreRegime = z.infer<typeof dreRegimeSchema>;

export const dreSchema = z.object({
  from: z.string(),
  to: z.string(),
  lines: z.array(dreLineSchema),
  regime: dreRegimeSchema,
  /** o período anterior do mesmo tamanho, para comparar */
  previous: z.object({ from: z.string(), to: z.string(), lines: z.array(dreLineSchema) }),
});
export type Dre = z.infer<typeof dreSchema>;
