import { z } from 'zod';

/**
 * Análises do financeiro (E51, fase 3): os indicadores que o dono da oficina
 * olha para decidir, calculados na hora a partir do que já está no sistema.
 * Nada é estimado à parte: cada número usa a mesma regra da DRE e dos
 * relatórios, para a tela de análises nunca contradizer as outras.
 *
 * - faturado: receita bruta por competência (OS finalizada + venda de balcão);
 * - ticket médio: o que a OS finalizada vale (aprovado, ou total) ÷ nº de OS;
 * - clientes que voltaram: dos clientes com OS finalizada no período, os que
 *   já tinham OS finalizada ANTES dele;
 * - giro de estoque: custo das peças que saíram ÷ estoque médio (a custo) do
 *   começo e do fim do período; e para quantos dias o estoque de agora dá;
 * - serviço mais lucrativo: valor cobrado − comissão do mecânico (serviço não
 *   tem custo de peça), e quanto isso rende por hora de trabalho;
 * - produtividade: horas VENDIDAS (tempo do catálogo dos serviços entregues)
 *   contra horas TRABALHADAS (cronômetro). A eficiência só compara os serviços
 *   que têm as duas coisas, senão quem cronometra metade parece rápido demais.
 */

export const ANALISES_JANELAS = [1, 3, 6, 12] as const;
export type AnalisesJanela = (typeof ANALISES_JANELAS)[number];
export const ANALISES_JANELA_LABELS: Record<AnalisesJanela, string> = {
  1: 'Este mês',
  3: '3 meses',
  6: '6 meses',
  12: '12 meses',
};

/** Quantos meses o gráfico "mês a mês" mostra, terminando no mês atual. */
export const ANALISES_MESES_NO_GRAFICO = 12;
/** Quantas linhas cada ranking traz. */
export const ANALISES_TOP = 10;

export const analisesQuerySchema = z.object({
  meses: z.coerce
    .number()
    .int()
    .refine((n): n is AnalisesJanela => (ANALISES_JANELAS as readonly number[]).includes(n), {
      message: 'Escolha 1, 3, 6 ou 12 meses.',
    })
    .default(3),
});
export type AnalisesQuery = z.infer<typeof analisesQuerySchema>;

const comparado = z.object({ atual: z.number(), anterior: z.number() });

export const analisesSchema = z.object({
  /** quando foi calculado (ISO): a tela mostra "atualizado às …" */
  geradoEm: z.string(),
  meses: z.number().int(),
  /** o período dos indicadores e rankings: do 1º dia de N−1 meses atrás até hoje */
  periodo: z.object({ de: z.string(), ate: z.string() }),
  /** o mesmo trecho N meses antes, para a comparação */
  anterior: z.object({ de: z.string(), ate: z.string() }),
  indicadores: z.object({
    faturadoCents: comparado,
    ordens: comparado,
    ticketMedioCents: comparado,
    clientes: z.object({
      atendidos: comparado,
      voltaram: comparado,
    }),
    estoque: z.object({
      custoSaidasCents: z.number(),
      inicialCents: z.number(),
      finalCents: z.number(),
      /** giro no período, em centésimos (1,5 vez = 150); null sem estoque */
      giroCentesimos: z.number().nullable(),
      /** para quantos dias o estoque de hoje dá, no ritmo do período; null sem saída */
      diasDeEstoque: z.number().nullable(),
    }),
    equipe: z.object({
      vendidoMin: z.number(),
      trabalhadoMin: z.number(),
      /** horas vendidas ÷ trabalhadas, só dos serviços cronometrados, em basis points */
      eficienciaBps: z.number().nullable(),
    }),
  }),
  /** mês a mês, do mais antigo ao atual (o atual vai até hoje) */
  mesAMes: z.array(
    z.object({
      mes: z.string(),
      parcial: z.boolean(),
      faturadoCents: z.number(),
      ordens: z.number(),
      ticketMedioCents: z.number(),
      lucroLiquidoCents: z.number(),
    }),
  ),
  servicos: z.array(
    z.object({
      servico: z.string(),
      vezes: z.number(),
      faturadoCents: z.number(),
      comissaoCents: z.number(),
      lucroCents: z.number(),
      /** minutos de trabalho: o cronômetro quando há, senão o tempo do catálogo */
      minutos: z.number(),
      /** de onde vieram os minutos */
      fonteDoTempo: z.enum(['cronometro', 'catalogo', 'misto']).nullable(),
      /** lucro por hora; null sem tempo nenhum */
      lucroPorHoraCents: z.number().nullable(),
    }),
  ),
  pecas: z.array(
    z.object({
      peca: z.string(),
      /** o que saiu (OS + balcão − devolução do balcão) */
      quantidade: z.number(),
      custoCents: z.number(),
      saldo: z.number().nullable(),
      diasDeEstoque: z.number().nullable(),
    }),
  ),
  mecanicos: z.array(
    z.object({
      mecanico: z.string(),
      servicos: z.number(),
      faturadoCents: z.number(),
      vendidoMin: z.number(),
      trabalhadoMin: z.number(),
      eficienciaBps: z.number().nullable(),
    }),
  ),
});
export type Analises = z.infer<typeof analisesSchema>;

// ------------------------------ contas puras ------------------------------

/** Parte ÷ todo em basis points; null quando não há todo. */
export function taxaBps(parte: number, todo: number): number | null {
  return todo > 0 ? Math.round((parte / todo) * 10_000) : null;
}

/** Variação do atual contra o anterior em basis points; null quando não há base. */
export function variacaoBps(atual: number, anterior: number): number | null {
  return anterior !== 0 ? Math.round(((atual - anterior) / Math.abs(anterior)) * 10_000) : null;
}

/**
 * Giro: quantas vezes o estoque "girou" no período (custo do que saiu ÷
 * estoque médio). E cobertura: o estoque de hoje ÷ o custo que sai por dia.
 */
export function giroDeEstoque(e: {
  custoSaidasCents: number;
  inicialCents: number;
  finalCents: number;
  dias: number;
}): { giroCentesimos: number | null; diasDeEstoque: number | null } {
  const medio = (e.inicialCents + e.finalCents) / 2;
  return {
    giroCentesimos: medio > 0 ? Math.round((e.custoSaidasCents / medio) * 100) : null,
    diasDeEstoque: e.custoSaidasCents > 0 && e.dias > 0 ? Math.round(e.finalCents / (e.custoSaidasCents / e.dias)) : null,
  };
}

/** Para quantos dias o saldo de uma peça dá, no ritmo de saída do período. */
export function diasDeEstoqueDaPeca(saldo: number | null, saiu: number, dias: number): number | null {
  if (saldo === null || saiu <= 0 || dias <= 0) return null;
  return Math.max(0, Math.round(saldo / (saiu / dias)));
}

/** Lucro por hora em centavos; null sem tempo. */
export function porHora(cents: number, minutos: number): number | null {
  return minutos > 0 ? Math.round((cents / minutos) * 60) : null;
}
