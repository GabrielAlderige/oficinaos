/**
 * Cálculo do orçamento (docs/ARCHITECTURE.md §9). Tudo inteiro: quantidade em
 * milésimos, dinheiro em centavos, percentual em basis points.
 *
 * Arredondamento **meio para cima** na LINHA, antes de somar: o total impresso
 * sempre bate com a soma das linhas impressas. A API recalcula por aqui a cada
 * gravação e ignora qualquer total enviado pelo front.
 */

import type { DiscountMode, WorkOrderItemType } from './enums/work-orders';

export interface PricingLine {
  type: WorkOrderItemType;
  /** quantidade em milésimos (4,5 L → 4500) */
  quantityMilli: number;
  unitPriceCents: number;
  discountCents: number;
  /** item recomendado: o cliente pode desmarcar na página pública (E6) */
  isOptional?: boolean;
  /** usado só no cálculo do aprovado */
  approved?: boolean;
}

export interface PricingOptions {
  discountMode?: DiscountMode | null;
  /** centavos quando AMOUNT, basis points quando PERCENT */
  discountValue?: number;
  surchargeCents?: number;
}

export interface Totals {
  partsSubtotalCents: number;
  servicesSubtotalCents: number;
  subtotalCents: number;
  discountCents: number;
  surchargeCents: number;
  totalCents: number;
}

/** Divisão com arredondamento meio para cima, em inteiros (sem float). */
function divideHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

/** quantidade × preço unitário, com a quantidade em milésimos. */
export function lineGrossCents(quantityMilli: number, unitPriceCents: number): number {
  return divideHalfUp(BigInt(quantityMilli) * BigInt(unitPriceCents), 1000n);
}

/** Bruto da linha menos o desconto da linha. Nunca negativo. */
export function lineTotalCents(line: PricingLine): number {
  return Math.max(0, lineGrossCents(line.quantityMilli, line.unitPriceCents) - line.discountCents);
}

/** Desconto geral: percentual sobre o subtotal, ou valor. Nunca passa do subtotal. */
export function discountCentsFor(subtotalCents: number, mode: DiscountMode | null | undefined, value: number): number {
  if (!mode || value <= 0 || subtotalCents <= 0) return 0;
  const raw = mode === 'PERCENT' ? divideHalfUp(BigInt(subtotalCents) * BigInt(value), 10_000n) : value;
  return Math.min(raw, subtotalCents);
}

function sum(lines: PricingLine[], type: WorkOrderItemType): number {
  return lines.filter((line) => line.type === type).reduce((total, line) => total + lineTotalCents(line), 0);
}

function totalsOf(lines: PricingLine[], subtotalForDiscount: number, options: PricingOptions): Totals {
  const partsSubtotalCents = sum(lines, 'PART');
  const servicesSubtotalCents = sum(lines, 'SERVICE');
  const subtotalCents = partsSubtotalCents + servicesSubtotalCents;
  const discountCents = discountCentsFor(subtotalForDiscount, options.discountMode, options.discountValue ?? 0);
  const surchargeCents = options.surchargeCents ?? 0;
  return {
    partsSubtotalCents,
    servicesSubtotalCents,
    subtotalCents,
    discountCents: Math.min(discountCents, subtotalCents),
    surchargeCents,
    totalCents: Math.max(0, subtotalCents - Math.min(discountCents, subtotalCents)) + surchargeCents,
  };
}

/** Totais da OS inteira (é o que a tela mostra enquanto a pessoa monta o orçamento). */
export function computeTotals(lines: PricingLine[], options: PricingOptions = {}): Totals {
  const subtotal = sum(lines, 'PART') + sum(lines, 'SERVICE');
  return totalsOf(lines, subtotal, options);
}

/**
 * Totais do que o cliente aprovou (aprovação parcial, §9):
 * - desconto PERCENTUAL incide sobre o subtotal aprovado;
 * - desconto em VALOR é rateado pela fração aprovada do subtotal, para ninguém
 *   levar R$ 200 de desconto num item de R$ 100;
 * - o acréscimo NÃO é rateado: é taxa fixa da OS.
 */
export function computeApprovedTotals(lines: PricingLine[], options: PricingOptions = {}): Totals {
  const approvedLines = lines.filter((line) => line.approved);
  const fullSubtotal = sum(lines, 'PART') + sum(lines, 'SERVICE');
  const approvedSubtotal = sum(approvedLines, 'PART') + sum(approvedLines, 'SERVICE');

  if (options.discountMode === 'AMOUNT' && fullSubtotal > 0) {
    const rated = divideHalfUp(BigInt(options.discountValue ?? 0) * BigInt(approvedSubtotal), BigInt(fullSubtotal));
    return totalsOf(approvedLines, approvedSubtotal, { ...options, discountValue: rated });
  }
  return totalsOf(approvedLines, approvedSubtotal, options);
}

/**
 * O desconto cabe no limite do papel? (ARCHITECTURE §7: limite é configuração da
 * oficina, ex.: atendente até 10%.) Quem tem `work_orders:discount_unlimited`
 * não passa por aqui.
 */
export function isDiscountWithinLimit(subtotalCents: number, discountCents: number, limitBps: number): boolean {
  if (discountCents <= 0) return true;
  return discountCents <= divideHalfUp(BigInt(subtotalCents) * BigInt(limitBps), 10_000n);
}
