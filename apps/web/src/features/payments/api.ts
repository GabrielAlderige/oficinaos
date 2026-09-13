import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentList, PaymentMethod } from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { workOrderKeys } from '../work-orders/api';

export const paymentKeys = {
  all: ['payments'] as const,
  list: (workOrderId: string) => ['payments', workOrderId] as const,
};

export function usePayments(workOrderId: string) {
  return useQuery({
    queryKey: paymentKeys.list(workOrderId),
    queryFn: () => api<PaymentList>(`/work-orders/${workOrderId}/payments`),
  });
}

/**
 * Registrar pagamento muda o saldo e a situação da OS, então a ficha e a
 * timeline precisam ser relidas — quem calcula `paidCents` é a API, a partir
 * da soma dos lançamentos confirmados.
 */
export function useRecordPayment(workOrderId: string, workOrderNumber: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { method: PaymentMethod; amountCents: number; installments?: number; notes?: string }) =>
      api<PaymentList>(`/work-orders/${workOrderId}/payments`, { method: 'POST', json: body }),
    onSuccess: (lista) => {
      queryClient.setQueryData(paymentKeys.list(workOrderId), lista);
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.detail(workOrderNumber) });
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.timeline(workOrderId) });
      void queryClient.invalidateQueries({ queryKey: ['work-orders', 'list'] });
    },
  });
}

/** Lançamento errado não se apaga: cancela com motivo e o saldo reabre. */
export function useCancelPayment(workOrderId: string, workOrderNumber: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<PaymentList>(`/payments/${id}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: (lista) => {
      queryClient.setQueryData(paymentKeys.list(workOrderId), lista);
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.detail(workOrderNumber) });
      void queryClient.invalidateQueries({ queryKey: ['work-orders', 'list'] });
    },
  });
}
