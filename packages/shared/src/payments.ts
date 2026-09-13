/**
 * Regras puras de pagamento (docs/ARCHITECTURE.md §8.3).
 *
 * Moram aqui porque DOIS lugares precisam exatamente da mesma conta: o caixa
 * (registrar e cancelar lançamento) e o aviso de "veículo pronto", que diz ao
 * cliente quanto falta. Duplicar a conta seria garantir que um dia divirjam —
 * a mesma razão pela qual o `pricing.ts` existe.
 */

import type { PaymentStatus } from './enums/work-orders';

/**
 * O que a OS deve: o que o cliente APROVOU. Sem aprovação (serviço fechado
 * direto no balcão), cai no total da OS.
 */
export const devidoCents = (order: { approvedTotalCents: number; totalCents: number }): number =>
  order.approvedTotalCents > 0 ? order.approvedTotalCents : order.totalCents;

/** Quanto falta receber. Nunca negativo: pagar acima do saldo é recusado. */
export const saldoCents = (order: {
  approvedTotalCents: number;
  totalCents: number;
  paidCents: number;
}): number => Math.max(0, devidoCents(order) - order.paidCents);

/** A situação da OS sai da soma dos lançamentos confirmados, nunca da tela. */
export const statusDoPagamento = (pagoCents: number, devido: number): PaymentStatus => {
  if (devido > 0 && pagoCents >= devido) return 'PAID';
  return pagoCents > 0 ? 'PARTIAL' : 'UNPAID';
};
