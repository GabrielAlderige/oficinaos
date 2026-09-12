import { describe, expect, it } from 'vitest';
import { WORK_ORDER_STATUSES, type WorkOrderStatus } from '../enums/work-orders';
import type { Permission } from '../permissions';
import { permissionsFor } from '../permissions';
import {
  availableActions,
  canTransition,
  isEditable,
  nextStatus,
  WORK_ORDER_ACTIONS,
  WORK_ORDER_TRANSITIONS,
} from './work-order';

const asRole = (role: Parameters<typeof permissionsFor>[0]) => {
  const permissions = permissionsFor(role);
  return (permission: Permission) => permissions.includes(permission);
};

const actionsOf = (status: WorkOrderStatus, role: Parameters<typeof permissionsFor>[0]) =>
  availableActions(status, asRole(role)).map((a) => a.action);

describe('máquina de estados da OS', () => {
  it('o caminho normal da oficina, do balcão à entrega', () => {
    expect(nextStatus('OPEN', 'start-diagnosis')).toBe('DIAGNOSING');
    expect(nextStatus('DIAGNOSING', 'finish-diagnosis')).toBe('AWAITING_QUOTE');
    expect(nextStatus('AWAITING_QUOTE', 'send-quote')).toBe('AWAITING_APPROVAL');
    expect(nextStatus('AWAITING_APPROVAL', 'approve')).toBe('APPROVED');
    expect(nextStatus('APPROVED', 'start')).toBe('IN_PROGRESS');
    expect(nextStatus('IN_PROGRESS', 'complete')).toBe('COMPLETED');
    expect(nextStatus('COMPLETED', 'deliver')).toBe('DELIVERED');
  });

  it('peça faltando: espera e volta para a execução', () => {
    expect(nextStatus('IN_PROGRESS', 'wait-parts')).toBe('WAITING_PARTS');
    expect(nextStatus('WAITING_PARTS', 'start')).toBe('IN_PROGRESS');
  });

  it('recusa volta para "aguardando orçamento", para revisar', () => {
    expect(nextStatus('AWAITING_APPROVAL', 'reject')).toBe('AWAITING_QUOTE');
  });

  it('ações fora de hora são recusadas', () => {
    expect(canTransition('OPEN', 'complete')).toBe(false);
    expect(canTransition('OPEN', 'deliver')).toBe(false);
    expect(canTransition('APPROVED', 'finish-diagnosis')).toBe(false);
    expect(nextStatus('OPEN', 'deliver')).toBeNull();
  });

  it('cancelar vale em qualquer ponto antes da entrega, e exige motivo', () => {
    for (const status of WORK_ORDER_STATUSES) {
      const terminal = status === 'DELIVERED' || status === 'CANCELED';
      expect(canTransition(status, 'cancel'), status).toBe(!terminal);
    }
    expect(WORK_ORDER_TRANSITIONS.cancel.requiresReason).toBe(true);
  });

  it('entregue e cancelada são fim de linha: nada mais acontece', () => {
    for (const status of ['DELIVERED', 'CANCELED'] as const) {
      expect(actionsOf(status, 'OWNER'), status).toEqual([]);
      expect(isEditable(status), status).toBe(false);
    }
    expect(isEditable('IN_PROGRESS')).toBe(true);
  });

  it('reabrir só a partir de finalizada, e só quem tem a permissão', () => {
    expect(nextStatus('COMPLETED', 'reopen')).toBe('IN_PROGRESS');
    expect(canTransition('DELIVERED', 'reopen')).toBe(false);
    expect(actionsOf('COMPLETED', 'MANAGER')).toContain('reopen');
    expect(actionsOf('COMPLETED', 'MECHANIC')).not.toContain('reopen');
  });

  it('o mecânico trabalha na OS, mas não entrega nem cancela (§7, nota 4)', () => {
    expect(actionsOf('OPEN', 'MECHANIC')).toEqual(['start-diagnosis']);
    expect(actionsOf('IN_PROGRESS', 'MECHANIC')).toEqual(['wait-parts', 'complete']);
    expect(actionsOf('COMPLETED', 'MECHANIC')).toEqual([]);
    expect(actionsOf('COMPLETED', 'ATTENDANT')).toEqual(['deliver']);
    expect(actionsOf('IN_PROGRESS', 'MANAGER')).toEqual(['wait-parts', 'complete', 'cancel']);
  });

  it('o financeiro só olha: nenhuma ação de status', () => {
    for (const status of WORK_ORDER_STATUSES) {
      expect(actionsOf(status, 'FINANCE'), status).toEqual([]);
    }
  });

  it('enviar, aprovar e recusar não são botões da barra de status (vêm do orçamento)', () => {
    expect(actionsOf('AWAITING_QUOTE', 'OWNER')).not.toContain('send-quote');
    expect(actionsOf('AWAITING_APPROVAL', 'OWNER')).not.toContain('approve');
  });

  it('toda ação leva a um status que existe', () => {
    for (const action of WORK_ORDER_ACTIONS) {
      const transition = WORK_ORDER_TRANSITIONS[action];
      expect(WORK_ORDER_STATUSES, action).toContain(transition.to);
      expect(transition.from.length, action).toBeGreaterThan(0);
    }
  });
});
