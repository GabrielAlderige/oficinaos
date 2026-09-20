/**
 * Regras puras da cobrança online (E19). Mesmo motivo do `fiscal.ts`: a conta
 * aparece na tela (quanto cobrar), na API (ao criar a cobrança) e na
 * conciliação (ao dar baixa), e três cópias divergem um dia.
 */

import { addDays } from './calendar';
import type { ChargeMethod, ChargeStatus } from './enums/charges';
import type { PaymentMethod } from './enums/payments';

/**
 * Como o dinheiro da cobrança entra no caixa da OS. `LINK` vira `OTHER` até o
 * gateway dizer o que o cliente escolheu — e ele diz, no aviso do pagamento.
 */
export function metodoDoCaixa(metodo: ChargeMethod): PaymentMethod {
  switch (metodo) {
    case 'PIX':
      return 'PIX';
    case 'BOLETO':
      return 'BOLETO';
    case 'CREDIT_CARD':
      return 'CREDIT_CARD';
    default:
      return 'OTHER';
  }
}

/** Situação em que a cobrança ainda espera dinheiro. */
export const cobrancaAberta = (status: ChargeStatus): boolean => status === 'PENDING';

/**
 * Vencimento padrão: Pix e cartão vencem em 3 dias, boleto em 7 — boleto
 * registrado leva um dia útil para aparecer no banco do cliente, e vencer
 * antes disso só gera ligação para a oficina.
 */
export function vencimentoPadrao(hoje: string, metodo: ChargeMethod): string {
  return addDays(hoje, metodo === 'BOLETO' ? 7 : 3);
}

export interface LimiteDaCobranca {
  /** o que a OS ainda deve, em centavos */
  saldoCents: number;
  /** o que já está pendurado em cobrança aberta */
  emAbertoCents: number;
}

/**
 * Quanto ainda dá para cobrar. Sem isto, a oficina manda dois Pix do valor
 * inteiro e o cliente paga os dois — e aí a conversa é sobre devolver
 * dinheiro, que é a pior conversa que existe.
 */
export const disponivelParaCobrar = (limite: LimiteDaCobranca): number =>
  Math.max(0, limite.saldoCents - limite.emAbertoCents);

/** A mensagem de WhatsApp que leva o link do pagamento. */
export function whatsappChargeMessage(input: {
  customerName: string;
  shopName: string;
  amount: string;
  url: string;
}): string {
  const primeiro = input.customerName.trim().split(/\s+/)[0] ?? input.customerName;
  return [
    `Oi, ${primeiro}! Aqui é da ${input.shopName}.`,
    `Este é o link para pagar ${input.amount}:`,
    input.url,
    'Qualquer dúvida, é só responder por aqui.',
  ].join('\n\n');
}
