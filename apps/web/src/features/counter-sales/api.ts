import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CounterSale, CreateCounterSaleInput, Page } from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';

export const counterSaleKeys = {
  all: ['counter-sales'] as const,
  list: (page: number) => ['counter-sales', 'list', page] as const,
};

export function useCounterSales(page: number) {
  return useQuery({
    queryKey: counterSaleKeys.list(page),
    queryFn: () => api<Page<CounterSale>>(`/counter-sales?${toQueryString({ page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
}

/** Vender mexe em estoque, financeiro e painel: tudo isso é rebuscado. */
function useInvalidarDepoisDaVenda() {
  const queryClient = useQueryClient();
  return () => {
    for (const chave of [counterSaleKeys.all, ['parts'], ['finance'], ['dashboard']]) {
      void queryClient.invalidateQueries({ queryKey: chave });
    }
  };
}

export function useCreateCounterSale() {
  const invalidar = useInvalidarDepoisDaVenda();
  return useMutation({
    mutationFn: (input: CreateCounterSaleInput) => api<CounterSale>('/counter-sales', { method: 'POST', json: input }),
    onSuccess: invalidar,
  });
}

export function useCancelCounterSale() {
  const invalidar = useInvalidarDepoisDaVenda();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<CounterSale>(`/counter-sales/${id}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: invalidar,
  });
}
