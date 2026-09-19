/**
 * Pós-venda, avaliações e CRM (MVP 2, E16). Três coisas que só existem porque
 * a oficina perde cliente em silêncio: ninguém liga depois do serviço, ninguém
 * lembra da revisão, e o orçamento que não virou OS some do mundo.
 */

// ------------------------------- pós-venda -------------------------------

export const FOLLOW_UP_TYPES = ['POST_SALE_7D', 'MAINTENANCE_DUE', 'NO_RETURN_6M'] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  POST_SALE_7D: 'Uma semana depois do serviço',
  MAINTENANCE_DUE: 'Revisão vencendo',
  NO_RETURN_6M: 'Sem voltar há 6 meses',
};

export const FOLLOW_UP_TYPE_HINTS: Record<FollowUpType, string> = {
  POST_SALE_7D: 'Ligar para saber se ficou bom é o que transforma serviço em cliente fiel.',
  MAINTENANCE_DUE: 'Pelo intervalo do serviço (km ou meses): o cliente não lembra, a oficina lembra.',
  NO_RETURN_6M: 'Sumiu. Um "tudo bem por aí?" custa nada e às vezes traz o carro de volta.',
};

export const FOLLOW_UP_STATUSES = ['PENDING', 'DONE', 'SKIPPED'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  PENDING: 'Na fila',
  DONE: 'Contatado',
  SKIPPED: 'Dispensado',
};

/** Dias depois da entrega para o contato de pós-venda. */
export const POST_SALE_DAYS = 7;
/** Quantos dias antes do vencimento da revisão o contato entra na fila. */
export const MAINTENANCE_LEAD_DAYS = 15;
/** Meses sem voltar para o cliente cair na fila de resgate. */
export const NO_RETURN_MONTHS = 6;

// ------------------------------- avaliações -------------------------------

export const REVIEW_MIN = 1;
export const REVIEW_MAX = 5;

export const REVIEW_STAR_LABELS: Record<number, string> = {
  1: 'Péssimo',
  2: 'Ruim',
  3: 'Razoável',
  4: 'Bom',
  5: 'Excelente',
};

// ---------------------------------- CRM ----------------------------------

/**
 * O funil, na ordem em que a oficina fala. `LOST` é o fim triste e fica fora
 * do quadro do dia a dia (mas continua no relatório de conversão).
 */
export const LEAD_STAGES = ['NEW', 'CONTACTED', 'QUOTED', 'WAITING', 'WON', 'LOST'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: 'Novo contato',
  CONTACTED: 'Em conversa',
  QUOTED: 'Orçamento enviado',
  WAITING: 'Aguardando decisão',
  WON: 'Fechado',
  LOST: 'Perdido',
};

export const LEAD_STAGE_TONES = {
  NEW: 'neutral',
  CONTACTED: 'info',
  QUOTED: 'accent',
  WAITING: 'warning',
  WON: 'success',
  LOST: 'danger',
} as const satisfies Record<LeadStage, 'neutral' | 'info' | 'warning' | 'accent' | 'success' | 'danger'>;

/** Etapas que ainda estão vivas no funil. */
export const OPEN_LEAD_STAGES: readonly LeadStage[] = LEAD_STAGES.filter(
  (stage) => stage !== 'WON' && stage !== 'LOST',
);

export const LEAD_SOURCES = ['WALK_IN', 'PHONE', 'WHATSAPP', 'REFERRAL', 'SOCIAL', 'RETURNING', 'OTHER'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  WALK_IN: 'Passou na porta',
  PHONE: 'Telefone',
  WHATSAPP: 'WhatsApp',
  REFERRAL: 'Indicação',
  SOCIAL: 'Redes sociais',
  RETURNING: 'Cliente antigo',
  OTHER: 'Outro',
};
