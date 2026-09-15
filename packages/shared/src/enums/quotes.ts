/**
 * Orçamento: o diferencial do produto (docs/ARCHITECTURE.md §8.1 e §8.2,
 * docs/DATABASE.md §5.6). O orçamento é um SNAPSHOT do que o cliente viu e
 * aprovou — a OS continua viva, o orçamento não muda depois de enviado.
 */

export const QUOTE_STATUSES = [
  'SENT',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
  'REVOKED',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  SENT: 'Aguardando resposta',
  APPROVED: 'Aprovado',
  PARTIALLY_APPROVED: 'Aprovado em parte',
  REJECTED: 'Recusado',
  EXPIRED: 'Expirado',
  SUPERSEDED: 'Substituído',
  REVOKED: 'Cancelado',
};

export const QUOTE_STATUS_TONES = {
  SENT: 'warning',
  APPROVED: 'success',
  PARTIALLY_APPROVED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'neutral',
  SUPERSEDED: 'neutral',
  REVOKED: 'neutral',
} as const satisfies Record<QuoteStatus, 'neutral' | 'info' | 'warning' | 'accent' | 'success' | 'danger'>;

/** O cliente ainda pode responder: o link está valendo. */
export const OPEN_QUOTE_STATUSES = ['SENT'] as const;

export const QUOTE_KINDS = ['INITIAL', 'SUPPLEMENTARY'] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];
export const QUOTE_KIND_LABELS: Record<QuoteKind, string> = {
  INITIAL: 'Orçamento',
  SUPPLEMENTARY: 'Orçamento complementar',
};

export const APPROVAL_DECISIONS = ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = {
  APPROVED: 'Aprovou tudo',
  PARTIALLY_APPROVED: 'Aprovou em parte',
  REJECTED: 'Recusou',
};

/**
 * Por onde veio a resposta. `PUBLIC_LINK` é a assinatura eletrônica simples
 * (Lei 14.063/2020: data, IP, aparelho, nome digitado, aceite e hash); os
 * outros são a realidade da oficina — muita gente responde "pode fazer" por
 * telefone, e o sistema tem que registrar QUEM anotou isso.
 */
export const APPROVAL_CHANNELS = ['PUBLIC_LINK', 'PHONE', 'IN_PERSON', 'WHATSAPP'] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];
export const APPROVAL_CHANNEL_LABELS: Record<ApprovalChannel, string> = {
  PUBLIC_LINK: 'Pelo link',
  PHONE: 'Por telefone',
  IN_PERSON: 'Presencial',
  WHATSAPP: 'Pelo WhatsApp',
};

/** Como o orçamento saiu da oficina. */
export const SHARE_CHANNELS = ['WHATSAPP_LINK', 'COPY_LINK', 'PRINT'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export const NOTIFICATION_TYPES = [
  'QUOTE_VIEWED',
  'QUOTE_APPROVED',
  'QUOTE_PARTIALLY_APPROVED',
  'QUOTE_REJECTED',
  'QUOTE_QUESTION',
  /** um fornecedor respondeu a cotação por link (E11) */
  'SUPPLIER_QUOTE_ANSWERED',
  /** chegou peça comprada para uma OS (E12) */
  'PURCHASE_RECEIVED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  QUOTE_VIEWED: 'Orçamento visualizado',
  QUOTE_APPROVED: 'Orçamento aprovado',
  QUOTE_PARTIALLY_APPROVED: 'Orçamento aprovado em parte',
  QUOTE_REJECTED: 'Orçamento recusado',
  QUOTE_QUESTION: 'Pergunta do cliente',
  SUPPLIER_QUOTE_ANSWERED: 'Fornecedor respondeu a cotação',
  PURCHASE_RECEIVED: 'Peça chegou',
};

export const MESSAGE_CHANNELS = ['WHATSAPP_LINK', 'EMAIL', 'PUBLIC_PAGE'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_DIRECTIONS = ['OUTBOUND', 'INBOUND'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/**
 * `LINK_OPENED` é o máximo que o V1 sabe: o link wa.me não confirma entrega
 * nem leitura. Prometer "entregue" sem a API oficial seria mentira de tela.
 */
export const MESSAGE_STATUSES = ['LINK_OPENED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Validade padrão do orçamento, em dias. A oficina pode estender depois. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 7;
