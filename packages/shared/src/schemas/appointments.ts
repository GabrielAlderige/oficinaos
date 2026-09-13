import { z } from 'zod';
import { APPOINTMENT_STATUSES } from '../enums/appointments';
import { optionalText } from './common';

const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida');

/** Agendamento de 5 min não existe; acima de 12 h é erro de digitação, não compromisso. */
const MIN_MINUTES = 5;
const MAX_MINUTES = 12 * 60;

const interval = {
  startsAt: isoDateTime,
  endsAt: isoDateTime,
};

function checkDuration(value: { startsAt: string; endsAt: string }, ctx: z.RefinementCtx) {
  const minutes = (Date.parse(value.endsAt) - Date.parse(value.startsAt)) / 60_000;
  if (minutes < MIN_MINUTES) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'O fim precisa ser depois do início' });
  } else if (minutes > MAX_MINUTES) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Um agendamento vai até 12 horas' });
  }
}

const appointmentFields = {
  customerId: z.uuid(),
  /** o veículo pode chegar sem cadastro e ser criado no check-in (§5.4) */
  vehicleId: z.uuid().nullable().default(null),
  /** sem mecânico definido o compromisso não disputa a hora de ninguém */
  mechanicUserId: z.uuid().nullable().default(null),
  serviceId: z.uuid().nullable().default(null),
  title: z.string().trim().min(2, 'Diga o que vai ser feito').max(120),
  ...interval,
  notes: optionalText(1000).default(''),
};

/**
 * `force` é a resposta ao "confirmar mesmo assim": sem ele, horário disputado
 * devolve 422 `APPOINTMENT_CONFLICT` com a lista de quem colide. Oficina de
 * verdade encaixa cliente — o sistema avisa, não impede.
 */
export const createAppointmentSchema = z
  .object({ ...appointmentFields, force: z.boolean().default(false) })
  .superRefine(checkDuration);

/** Remarcar. É também o que o arrastar e soltar manda: horário novo e, às vezes, outro mecânico. */
export const rescheduleAppointmentSchema = z
  .object({
    ...interval,
    mechanicUserId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    serviceId: z.uuid().nullable(),
    title: z.string().trim().min(2).max(120),
    notes: optionalText(1000),
    force: z.boolean().default(false),
  })
  .partial()
  .superRefine((value, ctx) => {
    if (value.startsAt === undefined && value.endsAt === undefined) return;
    if (value.startsAt === undefined || value.endsAt === undefined) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Mande início e fim juntos' });
      return;
    }
    checkDuration({ startsAt: value.startsAt, endsAt: value.endsAt }, ctx);
  });

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo do cancelamento').max(200),
});

/** A grade pede sempre uma janela: `from` e `to` são o que está na tela. */
export const appointmentListQuerySchema = z.object({
  from: isoDateTime,
  to: isoDateTime,
  mechanicId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  vehicleId: z.uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

/** Conferência antes de gravar: a tela avisa do conflito enquanto a pessoa preenche. */
export const conflictQuerySchema = z.object({
  mechanicId: z.uuid().optional(),
  ...interval,
  excludeId: z.uuid().optional(),
});

/**
 * Check-in a partir do agendamento: o carro chegou, a OS nasce. O cliente vem
 * do agendamento; o veículo pode vir agora, porque em §5.4 ele pode ter sido
 * marcado sem cadastro. A vistoria com fotos continua sendo o passo seguinte,
 * na tela da OS, como na E5.
 */
export const appointmentCheckInSchema = z.object({
  vehicleId: z.uuid().nullable().default(null),
  odometerKm: z.number().int().min(0).max(9_999_999).nullable().default(null),
  complaint: optionalText(2000).default(''),
  promisedAt: isoDateTime.nullable().default(null),
  advisorUserId: z.uuid().nullable().default(null),
  mechanicUserId: z.uuid().nullable().default(null),
});

// ------------------------------- respostas --------------------------------

export const appointmentConflictSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  customerName: z.string(),
  mechanicName: z.string().nullable(),
});

export const appointmentSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  customerName: z.string(),
  customerPhone: z.string().nullable(),
  customerWhatsapp: z.string().nullable(),
  vehicleId: z.uuid().nullable(),
  vehicleLabel: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  mechanicUserId: z.uuid().nullable(),
  mechanicName: z.string().nullable(),
  /** cor do mecânico na agenda (`memberships.calendar_color`) */
  mechanicColor: z.string().nullable(),
  serviceId: z.uuid().nullable(),
  serviceName: z.string().nullable(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  notes: z.string().nullable(),
  /** preenchido no check-in: daqui a tela leva para a OS */
  workOrderId: z.uuid().nullable(),
  workOrderNumber: z.number().int().nullable(),
  confirmedAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
});

export const appointmentListSchema = z.object({ data: z.array(appointmentSchema) });

export const conflictListSchema = z.object({ data: z.array(appointmentConflictSchema) });

export type CreateAppointmentInput = z.output<typeof createAppointmentSchema>;
export type RescheduleAppointmentInput = z.output<typeof rescheduleAppointmentSchema>;
export type CancelAppointmentInput = z.output<typeof cancelAppointmentSchema>;
export type AppointmentListQuery = z.output<typeof appointmentListQuerySchema>;
export type ConflictQuery = z.output<typeof conflictQuerySchema>;
export type AppointmentCheckInInput = z.output<typeof appointmentCheckInSchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
export type AppointmentConflict = z.infer<typeof appointmentConflictSchema>;
