/**
 * Pagamento no MVP 1 é **registro manual**: a oficina anota o que já recebeu.
 * Gateway (Pix com QR, cartão, boleto) é V3 — aqui nada é cobrado, só anotado.
 */
export const PAYMENT_METHODS = [
  'PIX',
  'CASH',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'BOLETO',
  'BANK_TRANSFER',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  CASH: 'Dinheiro',
  DEBIT_CARD: 'Cartão de débito',
  CREDIT_CARD: 'Cartão de crédito',
  BOLETO: 'Boleto',
  BANK_TRANSFER: 'Transferência',
  OTHER: 'Outro',
};

/**
 * Situação do LANÇAMENTO, que não é a mesma coisa que `PAYMENT_STATUSES` (a
 * situação da OS: a pagar, parcial, pago). Pagamento nunca é apagado — quando
 * foi erro, vira `CANCELED` com motivo, e o histórico continua lá.
 */
export const PAYMENT_ENTRY_STATUSES = ['CONFIRMED', 'CANCELED'] as const;
export type PaymentEntryStatus = (typeof PAYMENT_ENTRY_STATUSES)[number];

export const PAYMENT_ENTRY_STATUS_LABELS: Record<PaymentEntryStatus, string> = {
  CONFIRMED: 'Confirmado',
  CANCELED: 'Cancelado',
};
