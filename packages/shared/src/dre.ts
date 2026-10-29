import { z } from 'zod';
import { lucroEstimado } from './finance';

/**
 * DRE da oficina (E49): o resultado do período do jeito que o contador lê —
 * receita, o que sai dela, e o que sobra — com a mesma regra do lucro
 * estimado. A última linha da DRE É o lucro estimado: o sistema inteiro tem um
 * número só para "lucro" (o teste dos relatórios compara os dois).
 *
 * Regime: a receita entra pelo que foi ENTREGUE no período (OS finalizada,
 * venda de balcão), e a despesa pelo que foi PAGO. É o que a oficina pequena
 * consegue manter certo sem contador do lado; está escrito na tela.
 */

export interface DreEntrada {
  receitaOsCents: number;
  receitaBalcaoCents: number;
  custoPecasCents: number;
  /** o que foi pago no período, por categoria, como sai de `despesasPorCategoria` */
  despesas: { name: string; systemKey: string | null; amountCents: number }[];
}

export const DRE_LINE_KINDS = ['receita', 'deducao', 'subtotal', 'resultado'] as const;
export type DreLineKind = (typeof DRE_LINE_KINDS)[number];

export const dreLineSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(DRE_LINE_KINDS),
  /** com sinal: dedução é negativa */
  amountCents: z.number().int(),
  /** fração da receita bruta, em basis points (1250 = 12,5%) */
  shareBps: z.number().int(),
});
export type DreLine = z.infer<typeof dreLineSchema>;

const bps = (valor: number, base: number) => (base > 0 ? Math.round((valor / base) * 10_000) : 0);

/**
 * As linhas da DRE, na ordem. "Peças e insumos" pagos ficam de fora das
 * despesas pela mesma razão do lucro estimado: a peça já entrou pelo custo
 * da peça que saiu do estoque.
 */
export function montarDre(entrada: DreEntrada): DreLine[] {
  const bruta = entrada.receitaOsCents + entrada.receitaBalcaoCents;
  const impostos = entrada.despesas.filter((d) => d.systemKey === 'TAXES').reduce((s, d) => s + d.amountCents, 0);
  const comissoes = entrada.despesas.filter((d) => d.systemKey === 'COMMISSIONS').reduce((s, d) => s + d.amountCents, 0);
  const operacionais = entrada.despesas.filter(
    (d) => d.systemKey !== 'PARTS' && d.systemKey !== 'TAXES' && d.systemKey !== 'COMMISSIONS',
  );
  const totalOperacionais = operacionais.reduce((s, d) => s + d.amountCents, 0);

  const liquida = bruta - impostos;
  const bruto = liquida - entrada.custoPecasCents - comissoes;
  const resultado = bruto - totalOperacionais;

  const linha = (key: string, label: string, kind: DreLineKind, amountCents: number): DreLine => ({
    key,
    label,
    kind,
    amountCents,
    shareBps: bps(amountCents, bruta),
  });

  return [
    linha('receita_os', 'Serviços e peças das OS', 'receita', entrada.receitaOsCents),
    linha('receita_balcao', 'Venda de balcão', 'receita', entrada.receitaBalcaoCents),
    linha('receita_bruta', 'Receita bruta', 'subtotal', bruta),
    linha('impostos', 'Impostos e taxas pagos', 'deducao', -impostos),
    linha('receita_liquida', 'Receita líquida', 'subtotal', liquida),
    linha('custo_pecas', 'Custo das peças vendidas', 'deducao', -entrada.custoPecasCents),
    linha('comissoes', 'Comissões dos mecânicos', 'deducao', -comissoes),
    linha('lucro_bruto', 'Lucro bruto', 'subtotal', bruto),
    ...operacionais.map((d, i) => linha(`despesa_${i}`, d.name, 'deducao', -d.amountCents)),
    linha('despesas_operacionais', 'Despesas operacionais', 'subtotal', -totalOperacionais),
    linha('resultado', 'Resultado do período', 'resultado', resultado),
  ];
}

/** A última linha, conferida contra o lucro estimado: as duas contas são a mesma. */
export function resultadoDaDre(entrada: DreEntrada): number {
  const despesasCents = entrada.despesas.filter((d) => d.systemKey !== 'PARTS').reduce((s, d) => s + d.amountCents, 0);
  return lucroEstimado({
    receitaCents: entrada.receitaOsCents + entrada.receitaBalcaoCents,
    custoPecasCents: entrada.custoPecasCents,
    despesasCents,
  }).lucroCents;
}

export const dreSchema = z.object({
  from: z.string(),
  to: z.string(),
  lines: z.array(dreLineSchema),
  /** o período anterior do mesmo tamanho, para comparar */
  previous: z.object({ from: z.string(), to: z.string(), lines: z.array(dreLineSchema) }),
});
export type Dre = z.infer<typeof dreSchema>;
