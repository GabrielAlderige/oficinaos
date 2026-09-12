/**
 * Ordem de serviço (docs/ARCHITECTURE.md §8.3 e docs/DATABASE.md §5.5).
 * Os rótulos são o que a equipe da oficina lê na tela.
 */

export const WORK_ORDER_STATUSES = [
  'OPEN',
  'DIAGNOSING',
  'AWAITING_QUOTE',
  'AWAITING_APPROVAL',
  'APPROVED',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'COMPLETED',
  'DELIVERED',
  'CANCELED',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  OPEN: 'Aberta',
  DIAGNOSING: 'Em diagnóstico',
  AWAITING_QUOTE: 'Aguardando orçamento',
  AWAITING_APPROVAL: 'Aguardando aprovação',
  APPROVED: 'Aprovada',
  IN_PROGRESS: 'Em execução',
  WAITING_PARTS: 'Aguardando peça',
  COMPLETED: 'Finalizada',
  DELIVERED: 'Entregue',
  CANCELED: 'Cancelada',
};

/** Cor do selo no painel (os tons são os mesmos do componente Badge). */
export const WORK_ORDER_STATUS_TONES = {
  OPEN: 'neutral',
  DIAGNOSING: 'info',
  AWAITING_QUOTE: 'info',
  AWAITING_APPROVAL: 'warning',
  APPROVED: 'accent',
  IN_PROGRESS: 'accent',
  WAITING_PARTS: 'warning',
  COMPLETED: 'success',
  DELIVERED: 'neutral',
  CANCELED: 'danger',
} as const satisfies Record<WorkOrderStatus, 'neutral' | 'info' | 'warning' | 'accent' | 'success' | 'danger'>;

/** O carro ainda está na oficina: base do quadro e de "veículos na oficina". */
export const ACTIVE_WORK_ORDER_STATUSES = WORK_ORDER_STATUSES.filter(
  (status) => status !== 'DELIVERED' && status !== 'CANCELED',
);

/** Fim de linha: não sai mais de lá (o reabrir é exceção e vem de COMPLETED). */
export const TERMINAL_WORK_ORDER_STATUSES = ['DELIVERED', 'CANCELED'] as const;

/** Pagamento é independente do status da OS: entregar com saldo em aberto é permitido. */
export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'A pagar',
  PARTIAL: 'Parcial',
  PAID: 'Pago',
};

// ------------------------------- itens da OS -------------------------------

export const WORK_ORDER_ITEM_TYPES = ['SERVICE', 'PART'] as const;
export type WorkOrderItemType = (typeof WORK_ORDER_ITEM_TYPES)[number];
export const WORK_ORDER_ITEM_TYPE_LABELS: Record<WorkOrderItemType, string> = {
  SERVICE: 'Serviço',
  PART: 'Peça',
};

/** DRAFT nasce na OS; o envio do orçamento (E6) congela em PENDING. */
export const ITEM_APPROVAL_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type ItemApprovalStatus = (typeof ITEM_APPROVAL_STATUSES)[number];
export const ITEM_APPROVAL_STATUS_LABELS: Record<ItemApprovalStatus, string> = {
  DRAFT: 'Rascunho',
  PENDING: 'Aguardando aprovação',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
};

/** De onde vem a peça. Só STOCK mexe no estoque (reserva na E6, baixa na E7). */
export const ITEM_SOURCINGS = ['STOCK', 'TO_ORDER', 'CUSTOMER_PROVIDED'] as const;
export type ItemSourcing = (typeof ITEM_SOURCINGS)[number];
export const ITEM_SOURCING_LABELS: Record<ItemSourcing, string> = {
  STOCK: 'Do estoque',
  TO_ORDER: 'Comprar',
  CUSTOMER_PROVIDED: 'Peça do cliente',
};

/** Situação da reserva do item. Nome diferente do STOCK_STATUS da peça, de propósito. */
export const ITEM_STOCK_STATUSES = ['NONE', 'RESERVED', 'PARTIAL', 'CONSUMED', 'RELEASED'] as const;
export type ItemStockStatus = (typeof ITEM_STOCK_STATUSES)[number];
export const ITEM_STOCK_STATUS_LABELS: Record<ItemStockStatus, string> = {
  NONE: 'Sem reserva',
  RESERVED: 'Reservado',
  PARTIAL: 'Reserva parcial',
  CONSUMED: 'Baixado',
  RELEASED: 'Reserva liberada',
};

export const DISCOUNT_MODES = ['AMOUNT', 'PERCENT'] as const;
export type DiscountMode = (typeof DISCOUNT_MODES)[number];
export const DISCOUNT_MODE_LABELS: Record<DiscountMode, string> = {
  AMOUNT: 'R$',
  PERCENT: '%',
};

// --------------------------- timeline (eventos) ---------------------------

export const WORK_ORDER_EVENT_TYPES = [
  'CREATED',
  'STATUS_CHANGED',
  'NOTE',
  'ITEMS_CHANGED',
  'CHECK_IN',
  'CHECK_OUT',
  'PHOTO_ADDED',
  'QUOTE_SENT',
  'QUOTE_VIEWED',
  'QUOTE_APPROVED',
  'QUOTE_REJECTED',
  'CUSTOMER_QUESTION',
  'PAYMENT',
  'DELIVERED',
  'CANCELED',
] as const;
export type WorkOrderEventType = (typeof WORK_ORDER_EVENT_TYPES)[number];
export const WORK_ORDER_EVENT_TYPE_LABELS: Record<WorkOrderEventType, string> = {
  CREATED: 'OS aberta',
  STATUS_CHANGED: 'Situação alterada',
  NOTE: 'Observação',
  ITEMS_CHANGED: 'Itens alterados',
  CHECK_IN: 'Check-in do veículo',
  CHECK_OUT: 'Check-out do veículo',
  PHOTO_ADDED: 'Foto adicionada',
  QUOTE_SENT: 'Orçamento enviado',
  QUOTE_VIEWED: 'Orçamento visualizado',
  QUOTE_APPROVED: 'Orçamento aprovado',
  QUOTE_REJECTED: 'Orçamento recusado',
  CUSTOMER_QUESTION: 'Pergunta do cliente',
  PAYMENT: 'Pagamento',
  DELIVERED: 'Veículo entregue',
  CANCELED: 'OS cancelada',
};

/** Quem gerou o evento: a equipe, o cliente na página pública (E6) ou o sistema. */
export const EVENT_ACTOR_TYPES = ['USER', 'CUSTOMER', 'SYSTEM'] as const;
export type EventActorType = (typeof EVENT_ACTOR_TYPES)[number];

// ------------------------------ check-in/out ------------------------------

export const INSPECTION_TYPES = ['CHECK_IN', 'CHECK_OUT'] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];
export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  CHECK_IN: 'Check-in (entrada)',
  CHECK_OUT: 'Check-out (saída)',
};

export const CHECKLIST_STATES = ['OK', 'ISSUE', 'NA'] as const;
export type ChecklistState = (typeof CHECKLIST_STATES)[number];
export const CHECKLIST_STATE_LABELS: Record<ChecklistState, string> = {
  OK: 'Ok',
  ISSUE: 'Problema',
  NA: 'Não se aplica',
};

/**
 * Checklist padrão do check-in. Cada oficina vai poder editar o modelo (E9);
 * por isso é gravado inteiro no `jsonb` da inspeção, e não em tabela.
 */
export const DEFAULT_CHECKIN_CHECKLIST = [
  { key: 'lights', label: 'Faróis e lanternas' },
  { key: 'tires', label: 'Pneus e estepe' },
  { key: 'brakes', label: 'Freios' },
  { key: 'fluids', label: 'Níveis de fluidos' },
  { key: 'battery', label: 'Bateria' },
  { key: 'belts', label: 'Correias e mangueiras' },
  { key: 'suspension', label: 'Suspensão' },
  { key: 'glass', label: 'Vidros e palhetas' },
  { key: 'body', label: 'Lataria e pintura' },
  { key: 'interior', label: 'Interior e bancos' },
  { key: 'electronics', label: 'Painel e elétrica' },
  { key: 'ac', label: 'Ar-condicionado' },
] as const;

/** Combustível em oitavos, como o ponteiro do painel. */
export const FUEL_LEVEL_LABELS: Record<number, string> = {
  0: 'Vazio',
  1: '1/8',
  2: '1/4',
  3: '3/8',
  4: '1/2',
  5: '5/8',
  6: '3/4',
  7: '7/8',
  8: 'Cheio',
};

export const DAMAGE_ZONES = [
  'FRONT_BUMPER',
  'HOOD',
  'WINDSHIELD',
  'ROOF',
  'FRONT_LEFT',
  'FRONT_RIGHT',
  'REAR_LEFT',
  'REAR_RIGHT',
  'LEFT_SIDE',
  'RIGHT_SIDE',
  'TRUNK',
  'REAR_BUMPER',
  'WHEELS',
  'INTERIOR',
] as const;
export type DamageZone = (typeof DAMAGE_ZONES)[number];
export const DAMAGE_ZONE_LABELS: Record<DamageZone, string> = {
  FRONT_BUMPER: 'Para-choque dianteiro',
  HOOD: 'Capô',
  WINDSHIELD: 'Para-brisa',
  ROOF: 'Teto',
  FRONT_LEFT: 'Dianteira esquerda',
  FRONT_RIGHT: 'Dianteira direita',
  REAR_LEFT: 'Traseira esquerda',
  REAR_RIGHT: 'Traseira direita',
  LEFT_SIDE: 'Lateral esquerda',
  RIGHT_SIDE: 'Lateral direita',
  TRUNK: 'Porta-malas',
  REAR_BUMPER: 'Para-choque traseiro',
  WHEELS: 'Rodas',
  INTERIOR: 'Interior',
};

export const DAMAGE_KINDS = ['SCRATCH', 'DENT', 'BROKEN', 'MISSING', 'RUST', 'OTHER'] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];
export const DAMAGE_KIND_LABELS: Record<DamageKind, string> = {
  SCRATCH: 'Risco',
  DENT: 'Amassado',
  BROKEN: 'Quebrado',
  MISSING: 'Faltando',
  RUST: 'Ferrugem',
  OTHER: 'Outro',
};

/** O que costuma ser conferido na entrada, para não sobrar discussão na entrega. */
export const DEFAULT_ACCESSORIES = [
  'Estepe',
  'Macaco',
  'Chave de roda',
  'Triângulo',
  'Tapetes',
  'Som/multimídia',
  'Documento do veículo',
] as const;

// -------------------------------- anexos ----------------------------------

export const ATTACHMENT_KINDS = ['PHOTO', 'VIDEO', 'DOCUMENT'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_STATUSES = ['PENDING_UPLOAD', 'READY'] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];
