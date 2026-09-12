/**
 * Máquina de estados da OS (docs/ARCHITECTURE.md §8.3). As transições são
 * **ações explícitas** (`POST /work-orders/{id}/start`), nunca um `PATCH status`:
 * cada ação tem permissão, validação e entrada na auditoria (docs/API.md §1).
 */

import type { Permission } from '../permissions';
import { TERMINAL_WORK_ORDER_STATUSES, WORK_ORDER_STATUSES, type WorkOrderStatus } from '../enums/work-orders';

export const WORK_ORDER_ACTIONS = [
  'start-diagnosis',
  'finish-diagnosis',
  'send-quote',
  'approve',
  'reject',
  'start',
  'wait-parts',
  'complete',
  'deliver',
  'cancel',
  'reopen',
] as const;
export type WorkOrderAction = (typeof WORK_ORDER_ACTIONS)[number];

export interface Transition {
  from: readonly WorkOrderStatus[];
  to: WorkOrderStatus;
  /** rótulo do botão na tela */
  label: string;
  permission: Permission;
  /**
   * Feita pelo sistema no fluxo do orçamento (E6), não por um botão da barra de
   * status: enviar, aprovar e recusar.
   */
  automatic?: boolean;
  requiresReason?: boolean;
}

const BEFORE_DELIVERY = WORK_ORDER_STATUSES.filter((status) => !TERMINAL_WORK_ORDER_STATUSES.includes(status as never));

export const WORK_ORDER_TRANSITIONS: Record<WorkOrderAction, Transition> = {
  'start-diagnosis': {
    from: ['OPEN'],
    to: 'DIAGNOSING',
    label: 'Iniciar diagnóstico',
    permission: 'work_orders:change_status',
  },
  'finish-diagnosis': {
    from: ['DIAGNOSING'],
    to: 'AWAITING_QUOTE',
    label: 'Concluir diagnóstico',
    permission: 'work_orders:change_status',
  },
  'send-quote': {
    from: ['OPEN', 'DIAGNOSING', 'AWAITING_QUOTE'],
    to: 'AWAITING_APPROVAL',
    label: 'Enviar orçamento',
    permission: 'quotes:send',
    automatic: true,
  },
  approve: {
    from: ['AWAITING_APPROVAL'],
    to: 'APPROVED',
    label: 'Registrar aprovação',
    permission: 'quotes:record_manual_approval',
    automatic: true,
  },
  reject: {
    from: ['AWAITING_APPROVAL'],
    to: 'AWAITING_QUOTE',
    label: 'Registrar recusa',
    permission: 'quotes:record_manual_approval',
    automatic: true,
  },
  start: {
    from: ['APPROVED', 'WAITING_PARTS'],
    to: 'IN_PROGRESS',
    label: 'Iniciar execução',
    permission: 'work_orders:change_status',
  },
  'wait-parts': {
    from: ['APPROVED', 'IN_PROGRESS'],
    to: 'WAITING_PARTS',
    label: 'Aguardando peça',
    permission: 'work_orders:change_status',
  },
  complete: {
    from: ['IN_PROGRESS'],
    to: 'COMPLETED',
    label: 'Finalizar serviço',
    permission: 'work_orders:change_status',
  },
  /**
   * Entregar tem permissão própria: o mecânico muda status (diagnóstico,
   * execução, finalizar), mas não entrega o carro (§7, nota 4). Checar papel no
   * guard quebraria a regra de verificar permissão, nunca papel.
   */
  deliver: {
    from: ['COMPLETED'],
    to: 'DELIVERED',
    label: 'Entregar veículo',
    permission: 'work_orders:deliver',
  },
  cancel: {
    from: BEFORE_DELIVERY,
    to: 'CANCELED',
    label: 'Cancelar OS',
    permission: 'work_orders:cancel',
    requiresReason: true,
  },
  reopen: {
    from: ['COMPLETED'],
    to: 'IN_PROGRESS',
    label: 'Reabrir',
    permission: 'work_orders:reopen',
  },
};

export function canTransition(from: WorkOrderStatus, action: WorkOrderAction): boolean {
  return WORK_ORDER_TRANSITIONS[action].from.includes(from);
}

/** Status depois da ação, ou `null` se a ação não vale a partir daqui. */
export function nextStatus(from: WorkOrderStatus, action: WorkOrderAction): WorkOrderStatus | null {
  return canTransition(from, action) ? WORK_ORDER_TRANSITIONS[action].to : null;
}

/** Ações que a pessoa pode fazer agora: a barra de status da OS é montada com isto. */
export function availableActions(
  status: WorkOrderStatus,
  has: (permission: Permission) => boolean,
): { action: WorkOrderAction; to: WorkOrderStatus; label: string; requiresReason: boolean }[] {
  return WORK_ORDER_ACTIONS.filter((action) => {
    const transition = WORK_ORDER_TRANSITIONS[action];
    return !transition.automatic && transition.from.includes(status) && has(transition.permission);
  }).map((action) => ({
    action,
    to: WORK_ORDER_TRANSITIONS[action].to,
    label: WORK_ORDER_TRANSITIONS[action].label,
    requiresReason: WORK_ORDER_TRANSITIONS[action].requiresReason ?? false,
  }));
}

/** OS entregue ou cancelada não recebe mais item nem edição (o reabrir é a exceção). */
export function isEditable(status: WorkOrderStatus): boolean {
  return !TERMINAL_WORK_ORDER_STATUSES.includes(status as never);
}
