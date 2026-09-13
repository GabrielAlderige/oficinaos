import { describe, expect, it } from 'vitest';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '../enums/appointments';
import type { Permission } from '../permissions';
import {
  APPOINTMENT_ACTIONS,
  availableAppointmentActions,
  canTransitionAppointment,
  isReschedulable,
  isTerminalAppointment,
  nextAppointmentStatus,
} from './appointment';

const all = () => true;
const none = () => false;
const only =
  (...permissions: Permission[]) =>
  (permission: Permission) =>
    permissions.includes(permission);

describe('máquina de estados do agendamento', () => {
  it('confirma, faz check-in e conclui', () => {
    expect(nextAppointmentStatus('SCHEDULED', 'confirm')).toBe('CONFIRMED');
    expect(nextAppointmentStatus('CONFIRMED', 'check-in')).toBe('IN_PROGRESS');
    expect(nextAppointmentStatus('IN_PROGRESS', 'complete')).toBe('COMPLETED');
  });

  it('aceita check-in de quem não confirmou: o cliente aparece sem avisar', () => {
    expect(canTransitionAppointment('SCHEDULED', 'check-in')).toBe(true);
  });

  it('não confirma duas vezes nem ressuscita agendamento encerrado', () => {
    expect(nextAppointmentStatus('CONFIRMED', 'confirm')).toBeNull();
    for (const status of ['COMPLETED', 'CANCELED', 'NO_SHOW'] as AppointmentStatus[]) {
      expect(APPOINTMENT_ACTIONS.filter((action) => canTransitionAppointment(status, action))).toEqual([]);
      expect(isTerminalAppointment(status)).toBe(true);
      expect(isReschedulable(status)).toBe(false);
    }
  });

  it('não cancela nem marca falta depois do check-in: quem manda ali é a OS', () => {
    expect(nextAppointmentStatus('IN_PROGRESS', 'cancel')).toBeNull();
    expect(nextAppointmentStatus('IN_PROGRESS', 'no-show')).toBeNull();
    expect(isReschedulable('IN_PROGRESS')).toBe(false);
  });

  it('só remarca o que ainda está de pé', () => {
    expect(isReschedulable('SCHEDULED')).toBe(true);
    expect(isReschedulable('CONFIRMED')).toBe(true);
  });

  it('cancelar exige motivo; marcar falta, não', () => {
    const actions = availableAppointmentActions('SCHEDULED', all);
    expect(actions.find((a) => a.action === 'cancel')?.requiresReason).toBe(true);
    expect(actions.find((a) => a.action === 'no-show')?.requiresReason).toBe(false);
  });

  it('quem não pode abrir OS não vê o check-in, mas ainda confirma', () => {
    const actions = availableAppointmentActions('SCHEDULED', only('appointments:write'));
    expect(actions.map((a) => a.action)).toEqual(['confirm', 'cancel', 'no-show']);
    expect(availableAppointmentActions('SCHEDULED', only('work_orders:write')).map((a) => a.action)).toEqual([
      'check-in',
    ]);
    expect(availableAppointmentActions('SCHEDULED', none)).toEqual([]);
  });

  it('toda situação do enum é tratada', () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(typeof isTerminalAppointment(status)).toBe('boolean');
    }
  });
});
