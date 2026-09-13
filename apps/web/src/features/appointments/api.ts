import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Appointment, AppointmentConflict, WorkOrder } from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { workOrderKeys } from '../work-orders/api';

export const appointmentKeys = {
  all: ['appointments'] as const,
  range: (from: string, to: string, mechanicId?: string) =>
    ['appointments', 'range', from, to, mechanicId ?? 'todos'] as const,
};

interface Janela {
  from: string;
  to: string;
  mechanicId?: string;
}

export function useAppointments({ from, to, mechanicId }: Janela) {
  const params = new URLSearchParams({ from, to });
  if (mechanicId) params.set('mechanicId', mechanicId);
  return useQuery({
    queryKey: appointmentKeys.range(from, to, mechanicId),
    queryFn: () => api<{ data: Appointment[] }>(`/appointments?${params}`),
    select: (resposta) => resposta.data,
  });
}

/**
 * Conferência enquanto a pessoa preenche o formulário. Fica desligada até ter
 * mecânico e horário: sem mecânico não existe conflito (a regra é a mesma da API).
 */
export function useConflicts(input: { mechanicId?: string | null; startsAt?: string; endsAt?: string; excludeId?: string }) {
  const ligada = Boolean(input.mechanicId && input.startsAt && input.endsAt);
  const params = new URLSearchParams();
  if (input.mechanicId) params.set('mechanicId', input.mechanicId);
  if (input.startsAt) params.set('startsAt', input.startsAt);
  if (input.endsAt) params.set('endsAt', input.endsAt);
  if (input.excludeId) params.set('excludeId', input.excludeId);
  return useQuery({
    queryKey: ['appointments', 'conflicts', params.toString()],
    queryFn: () => api<{ data: AppointmentConflict[] }>(`/appointments/conflicts?${params}`),
    select: (resposta) => resposta.data,
    enabled: ligada,
  });
}

/** Toda mudança na agenda relê a janela inteira: o bloco mudou de lugar na grade. */
function useAgendaMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

export interface AppointmentForm {
  customerId: string;
  vehicleId: string | null;
  mechanicUserId: string | null;
  serviceId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
  force?: boolean;
}

export function useCreateAppointment() {
  return useAgendaMutation((body: AppointmentForm) =>
    api<Appointment>('/appointments', { method: 'POST', json: body }),
  );
}

/** Remarcar. É também o que o arrastar e soltar manda. */
export function useRescheduleAppointment() {
  return useAgendaMutation(({ id, ...body }: Partial<AppointmentForm> & { id: string }) =>
    api<Appointment>(`/appointments/${id}`, { method: 'PATCH', json: body }),
  );
}

export type AppointmentAction = 'confirm' | 'complete' | 'no-show' | 'cancel';

export function useAppointmentAction() {
  return useAgendaMutation(({ id, action, reason }: { id: string; action: AppointmentAction; reason?: string }) =>
    api<Appointment>(`/appointments/${id}/${action}`, {
      method: 'POST',
      json: action === 'cancel' ? { reason } : undefined,
    }),
  );
}

/** O carro chegou: nasce a OS, e a tela segue para a ficha dela. */
export function useCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; vehicleId?: string | null; odometerKm?: number | null }) =>
      api<WorkOrder>(`/appointments/${id}/check-in`, { method: 'POST', json: body }),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.detail(order.number) });
      void queryClient.invalidateQueries({ queryKey: ['work-orders', 'list'] });
    },
  });
}

/** Mensagem pronta e link wa.me; quem aperta enviar é a pessoa da oficina. */
export function useAppointmentConfirmation() {
  return useAgendaMutation((id: string) =>
    api<{ message: string; whatsappUrl: string | null }>(`/appointments/${id}/confirmation`, { method: 'POST' }),
  );
}
