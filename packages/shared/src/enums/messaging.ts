/**
 * WhatsApp de verdade (V3, E22).
 *
 * Duas formas de mandar a mesma mensagem:
 *   LINK      o `wa.me` de sempre — abre o WhatsApp da oficina com o texto
 *             pronto, e uma pessoa aperta enviar. Não precisa de conta nenhuma.
 *   CLOUD_API a API oficial da Meta — a mensagem sai do servidor, o cliente
 *             responde e a resposta volta para dentro do sistema.
 *
 * Nenhuma biblioteca não oficial entra aqui, em nenhuma hipótese: número
 * bloqueado é a oficina sem o canal que ela usa para trabalhar.
 */

export const MESSAGING_PROVIDERS = ['LINK', 'CLOUD_API'] as const;
export type MessagingProvider = (typeof MESSAGING_PROVIDERS)[number];

export const MESSAGING_PROVIDER_LABELS: Record<MessagingProvider, string> = {
  LINK: 'Link do WhatsApp (você aperta enviar)',
  CLOUD_API: 'WhatsApp Business oficial (o sistema envia)',
};

export const CHANNEL_STATUSES = ['DISCONNECTED', 'CONNECTED', 'ERROR'] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  DISCONNECTED: 'Não conectado',
  CONNECTED: 'Conectado',
  ERROR: 'Com problema',
};

/**
 * Como a Meta classifica o modelo. Muda o que dá para enviar e quando:
 * `UTILITY` é sobre um serviço que o cliente contratou (aprova rápido);
 * `MARKETING` é reengajamento (exige consentimento e aprova devagar).
 */
export const TEMPLATE_CATEGORIES = ['UTILITY', 'MARKETING'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  UTILITY: 'Utilidade (sobre o serviço)',
  MARKETING: 'Marketing (reengajamento)',
};

/** O que a oficina informa depois de submeter o modelo à Meta. */
export const TEMPLATE_STATUSES = ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  NOT_SUBMITTED: 'Não enviado à Meta',
  PENDING: 'Em análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
};

/** As mensagens que o sistema sabe escrever. A chave é o `templateKey`. */
export const MESSAGE_TEMPLATE_KEYS = [
  'QUOTE_SENT',
  'VEHICLE_READY',
  'APPOINTMENT_CONFIRM',
  'CHARGE_LINK',
  'REVIEW_INVITE',
  'POST_SALE',
  'MAINTENANCE_DUE',
  'NO_RETURN',
] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];
