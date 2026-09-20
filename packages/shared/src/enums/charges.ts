/**
 * Cobrança online (V3, E19). É o pedido de pagamento que a oficina manda para
 * o cliente — Pix, boleto ou cartão — e que o gateway confirma sozinho.
 *
 * Não confunda com `payments`: **cobrança é a conta enviada, pagamento é o
 * dinheiro que entrou**. Quando o gateway avisa que pagou, a cobrança vira
 * `PAID` e nasce um pagamento no caixa da OS — o mesmo caixa do dinheiro
 * recebido na mão, para "recebido" continuar sendo um número só.
 */

export const CHARGE_METHODS = ['PIX', 'BOLETO', 'CREDIT_CARD', 'LINK'] as const;
export type ChargeMethod = (typeof CHARGE_METHODS)[number];

export const CHARGE_METHOD_LABELS: Record<ChargeMethod, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão de crédito',
  LINK: 'Link (o cliente escolhe como pagar)',
};

export const CHARGE_STATUSES = ['PENDING', 'PAID', 'CANCELED', 'EXPIRED', 'REFUNDED', 'FAILED'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pago',
  CANCELED: 'Cancelada',
  EXPIRED: 'Vencida',
  REFUNDED: 'Estornado',
  FAILED: 'Falhou',
};

export const CHARGE_STATUS_TONES = {
  PENDING: 'info',
  PAID: 'success',
  CANCELED: 'neutral',
  EXPIRED: 'warning',
  REFUNDED: 'warning',
  FAILED: 'danger',
} as const satisfies Record<ChargeStatus, 'neutral' | 'info' | 'warning' | 'accent' | 'success' | 'danger'>;

/** Onde o dinheiro entra: `simulador` não move dinheiro nenhum. */
export const PAYMENT_ENVIRONMENTS = ['SIMULATOR', 'SANDBOX', 'PRODUCTION'] as const;
export type PaymentEnvironment = (typeof PAYMENT_ENVIRONMENTS)[number];

export const PAYMENT_ENVIRONMENT_LABELS: Record<PaymentEnvironment, string> = {
  SIMULATOR: 'Simulação (nenhum dinheiro é movimentado)',
  SANDBOX: 'Sandbox do gateway (dinheiro de mentira)',
  PRODUCTION: 'Produção',
};
