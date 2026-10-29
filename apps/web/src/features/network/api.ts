import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateUnitInput, DashboardPeriod, NetworkOverview, StockTransferInput, StockTransferResult } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export function useNetwork(period: DashboardPeriod) {
  return useQuery({
    queryKey: ['network', period],
    queryFn: () => api<NetworkOverview>(`/network?period=${period}`),
    placeholderData: keepPreviousData,
  });
}

export function useCreateUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUnitInput) => api<{ id: string; name: string }>('/network/units', { method: 'POST', json: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['network'] }),
  });
}

export function useStockTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StockTransferInput) => api<StockTransferResult>('/network/transfers', { method: 'POST', json: input }),
    onSuccess: () => {
      for (const chave of [['network'], ['parts']]) void queryClient.invalidateQueries({ queryKey: chave });
    },
  });
}
