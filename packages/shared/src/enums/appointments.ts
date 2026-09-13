/**
 * Agenda (docs/DATABASE.md §5.4). O agendamento é o compromisso; a OS só nasce
 * no check-in, quando o carro chega de verdade. Por isso os dois têm situações
 * separadas: agendamento marcado ≠ veículo na oficina.
 */

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Agendado',
  CONFIRMED: 'Confirmado',
  IN_PROGRESS: 'Em atendimento',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
  NO_SHOW: 'Não compareceu',
};

/** Cor do selo e do bloco na grade (os tons são os mesmos do componente Badge). */
export const APPOINTMENT_STATUS_TONES = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'info',
  IN_PROGRESS: 'accent',
  COMPLETED: 'success',
  CANCELED: 'danger',
  NO_SHOW: 'warning',
} as const satisfies Record<AppointmentStatus, 'neutral' | 'info' | 'warning' | 'accent' | 'success' | 'danger'>;

/**
 * Acabou: não ocupa mais a agenda. Cancelado e não compareceu **não entram na
 * checagem de conflito** — o horário voltou a ficar livre.
 */
export const TERMINAL_APPOINTMENT_STATUSES = ['COMPLETED', 'CANCELED', 'NO_SHOW'] as const;

/** Ainda ocupa o horário do mecânico: é o que a checagem de conflito considera. */
export const BLOCKING_APPOINTMENT_STATUSES = APPOINTMENT_STATUSES.filter(
  (status) => !TERMINAL_APPOINTMENT_STATUSES.includes(status as never),
);

/** Duração padrão de um encaixe, em minutos, quando o serviço não diz quanto leva. */
export const DEFAULT_APPOINTMENT_MINUTES = 60;
