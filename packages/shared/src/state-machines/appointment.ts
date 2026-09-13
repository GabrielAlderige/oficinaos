/**
 * Máquina de estados do agendamento (docs/API.md §Agenda). Como na OS, cada
 * transição é uma **ação explícita** (`POST /appointments/{id}/confirm`), com
 * permissão e entrada na auditoria — nunca um `PATCH status`.
 *
 * O `check-in` é a ponte com a E5: ele cria a OS e o agendamento passa a
 * IN_PROGRESS. Por isso a permissão dele é `work_orders:write`, e não
 * `appointments:write`: quem marca horário não necessariamente abre OS.
 */

import type { Permission } from '../permissions';
import { TERMINAL_APPOINTMENT_STATUSES, type AppointmentStatus } from '../enums/appointments';

export const APPOINTMENT_ACTIONS = ['confirm', 'check-in', 'complete', 'cancel', 'no-show'] as const;
export type AppointmentAction = (typeof APPOINTMENT_ACTIONS)[number];

export interface AppointmentTransition {
  from: readonly AppointmentStatus[];
  to: AppointmentStatus;
  /** rótulo do botão na tela */
  label: string;
  permission: Permission;
  requiresReason?: boolean;
}

const OPEN_STATUSES = ['SCHEDULED', 'CONFIRMED'] as const;

export const APPOINTMENT_TRANSITIONS: Record<AppointmentAction, AppointmentTransition> = {
  confirm: {
    from: ['SCHEDULED'],
    to: 'CONFIRMED',
    label: 'Confirmar presença',
    permission: 'appointments:write',
  },
  'check-in': {
    from: OPEN_STATUSES,
    to: 'IN_PROGRESS',
    label: 'Fazer check-in',
    permission: 'work_orders:write',
  },
  complete: {
    from: ['IN_PROGRESS'],
    to: 'COMPLETED',
    label: 'Concluir',
    permission: 'appointments:write',
  },
  /**
   * Cancelar exige motivo: "sumiu da agenda" sem explicação vira discussão com
   * o cliente depois. Mesma regra do cancelamento de OS e de pagamento.
   */
  cancel: {
    from: OPEN_STATUSES,
    to: 'CANCELED',
    label: 'Cancelar',
    permission: 'appointments:write',
    requiresReason: true,
  },
  /**
   * Não compareceu é diferente de cancelado: o cliente não avisou. A oficina
   * precisa dos dois separados para saber quem costuma furar horário.
   */
  'no-show': {
    from: OPEN_STATUSES,
    to: 'NO_SHOW',
    label: 'Não compareceu',
    permission: 'appointments:write',
  },
};

export function canTransitionAppointment(from: AppointmentStatus, action: AppointmentAction): boolean {
  return APPOINTMENT_TRANSITIONS[action].from.includes(from);
}

/** Situação depois da ação, ou `null` se a ação não vale a partir daqui. */
export function nextAppointmentStatus(
  from: AppointmentStatus,
  action: AppointmentAction,
): AppointmentStatus | null {
  return canTransitionAppointment(from, action) ? APPOINTMENT_TRANSITIONS[action].to : null;
}

/** Ações que a pessoa pode fazer agora: o menu do bloco na agenda é montado com isto. */
export function availableAppointmentActions(
  status: AppointmentStatus,
  has: (permission: Permission) => boolean,
): { action: AppointmentAction; to: AppointmentStatus; label: string; requiresReason: boolean }[] {
  return APPOINTMENT_ACTIONS.filter((action) => {
    const transition = APPOINTMENT_TRANSITIONS[action];
    return transition.from.includes(status) && has(transition.permission);
  }).map((action) => ({
    action,
    to: APPOINTMENT_TRANSITIONS[action].to,
    label: APPOINTMENT_TRANSITIONS[action].label,
    requiresReason: APPOINTMENT_TRANSITIONS[action].requiresReason ?? false,
  }));
}

/**
 * Só dá para mudar horário, mecânico ou serviço enquanto o compromisso está de
 * pé. Depois do check-in quem manda é a OS, e agendamento encerrado não volta.
 */
export function isReschedulable(status: AppointmentStatus): boolean {
  return (OPEN_STATUSES as readonly AppointmentStatus[]).includes(status);
}

/** Acabou: não ocupa mais o horário do mecânico nem aparece na conferência de conflito. */
export function isTerminalAppointment(status: AppointmentStatus): boolean {
  return TERMINAL_APPOINTMENT_STATUSES.includes(status as never);
}

