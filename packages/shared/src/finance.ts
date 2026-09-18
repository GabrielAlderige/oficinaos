/**
 * Regras puras do financeiro (E13). Moram aqui, e não dentro de um service,
 * porque a MESMA conta aparece em três lugares: a API ao gravar a baixa, a
 * tela ao mostrar quanto falta, e o fluxo de caixa ao somar o período. É a
 * mesma razão do `pricing.ts` e do `payments.ts`.
 */

import { addMonths } from './calendar';
import type { FinancialEntryStatus, FinancialSituation } from './enums/finance';

/** A situação gravada sai SEMPRE da soma das baixas, nunca de valor da tela. */
export function statusDoLancamento(pagoCents: number, valorCents: number): Exclude<FinancialEntryStatus, 'CANCELED'> {
  if (valorCents > 0 && pagoCents >= valorCents) return 'PAID';
  return pagoCents > 0 ? 'PARTIAL' : 'OPEN';
}

/** Quanto falta receber (ou pagar). Nunca negativo. */
export const faltaCents = (entry: { amountCents: number; paidCents: number }): number =>
  Math.max(0, entry.amountCents - entry.paidCents);

/**
 * O que a tela mostra. "Vencida" é calculada: venceu ontem e ainda falta
 * dinheiro. Quitada e cancelada nunca vencem, mesmo com a data no passado.
 */
export function situacaoDoLancamento(
  entry: { status: FinancialEntryStatus; dueDate: string },
  hoje: string,
): FinancialSituation {
  if (entry.status === 'CANCELED' || entry.status === 'PAID') return entry.status;
  return entry.dueDate < hoje ? 'OVERDUE' : entry.status;
}

/** Dias de atraso (0 se ainda não venceu). Só para a tela ordenar e avisar. */
export function diasDeAtraso(dueDate: string, hoje: string): number {
  if (dueDate >= hoje) return 0;
  const [ay, am, ad] = dueDate.split('-').map(Number);
  const [by, bm, bd] = hoje.split('-').map(Number);
  const de = Date.UTC(ay!, am! - 1, ad!);
  const ate = Date.UTC(by!, bm! - 1, bd!);
  return Math.round((ate - de) / 86_400_000);
}

/**
 * Divide um valor em N parcelas sem perder centavo. A sobra vai para a
 * PRIMEIRA — é como a oficina cobra ("300,01 + 300,00 + 300,00") e como o
 * comércio brasileiro escreve o carnê.
 */
export function dividirEmParcelas(valorCents: number, quantidade: number): number[] {
  if (quantidade < 1) throw new RangeError('Parcelamento precisa de ao menos uma parcela');
  if (valorCents < quantidade) throw new RangeError('Valor pequeno demais para esse número de parcelas');
  const base = Math.floor(valorCents / quantidade);
  const sobra = valorCents - base * quantidade;
  return Array.from({ length: quantidade }, (_, i) => (i === 0 ? base + sobra : base));
}

/** Os vencimentos do carnê: mensais a partir da primeira data (31/01 → 28/02). */
export function vencimentosMensais(primeiro: string, quantidade: number): string[] {
  return Array.from({ length: quantidade }, (_, i) => (i === 0 ? primeiro : addMonths(primeiro, i)));
}

/**
 * Espalha o que o cliente pagou entre as parcelas da OS, **da mais velha para
 * a mais nova** — é assim que qualquer cobrança funciona, e é o que faz o
 * "vencidas" da tela parar de acusar uma parcela já coberta.
 *
 * Recebe as parcelas já na ordem de vencimento e devolve quanto cabe em cada
 * uma. O que sobrar depois de quitar todas fica de fora (crédito a favor do
 * cliente é assunto do V3).
 */
export function distribuirPagamento(pagoCents: number, parcelas: { amountCents: number }[]): number[] {
  let restante = Math.max(0, pagoCents);
  return parcelas.map((parcela) => {
    const cabe = Math.min(restante, parcela.amountCents);
    restante -= cabe;
    return cabe;
  });
}

export interface ResultadoEstimado {
  receitaCents: number;
  custoPecasCents: number;
  despesasCents: number;
  lucroCents: number;
  /** margem sobre a receita, em basis points (2550 = 25,5%) */
  margemBps: number;
}

/**
 * Lucro ESTIMADO do período (o nome tem "estimado" na tela de propósito).
 *
 * receita = o que foi faturado (OS finalizadas)
 * − custo das peças que saíram do estoque nessas OS (pelo custo médio)
 * − despesas pagas no período **fora da categoria "Peças"**
 *
 * A categoria "Peças" fica de fora porque a compra de peça já entra pelo custo
 * da peça usada; contar as duas seria descontar a mesma peça duas vezes — e a
 * oficina compra num mês para usar no outro.
 */
export function lucroEstimado(entrada: {
  receitaCents: number;
  custoPecasCents: number;
  despesasCents: number;
}): ResultadoEstimado {
  const lucroCents = entrada.receitaCents - entrada.custoPecasCents - entrada.despesasCents;
  return {
    ...entrada,
    lucroCents,
    margemBps: entrada.receitaCents > 0 ? Math.round((lucroCents / entrada.receitaCents) * 10_000) : 0,
  };
}
