import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChargeSummary, CreateChargeInput } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export const chargeKeys = {
  byWorkOrder: (workOrderId: string) => ['charges', workOrderId] as const,
};

export function useCharges(workOrderId: string, enabled = true) {
  return useQuery({
    queryKey: chargeKeys.byWorkOrder(workOrderId),
    queryFn: () => api<ChargeSummary>(`/work-orders/${workOrderId}/charges`),
    enabled,
  });
}

/**
 * Toda mutação de cobrança mexe no caixa da OS (a baixa vem pelo aviso do
 * gateway), então o pagamento e a própria OS são recarregados junto.
 */
function useChargeMutation<V>(workOrderId: string, mutationFn: (variables: V) => Promise<ChargeSummary>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (resumo) => {
      queryClient.setQueryData(chargeKeys.byWorkOrder(workOrderId), resumo);
      void queryClient.invalidateQueries({ queryKey: ['payments', workOrderId] });
      void queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    },
  });
}

export const useCreateCharge = (workOrderId: string) =>
  useChargeMutation(workOrderId, (body: CreateChargeInput) =>
    api<ChargeSummary>(`/work-orders/${workOrderId}/charges`, { method: 'POST', json: body }),
  );

export const useCancelCharge = (workOrderId: string) =>
  useChargeMutation(workOrderId, ({ id, reason }: { id: string; reason: string }) =>
    api<ChargeSummary>(`/charges/${id}/cancel`, { method: 'POST', json: { reason } }),
  );

export const useRefundCharge = (workOrderId: string) =>
  useChargeMutation(workOrderId, (id: string) => api<ChargeSummary>(`/charges/${id}/refund`, { method: 'POST' }));
