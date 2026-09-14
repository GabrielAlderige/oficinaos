import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Page, Supplier, SupplierInput, SupplierListItem } from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';

export interface SupplierListParams {
  q: string;
  category?: string;
  page: number;
  pageSize?: number;
}

export const supplierKeys = {
  all: ['suppliers'] as const,
  list: (params: SupplierListParams) => ['suppliers', 'list', params] as const,
  detail: (id: string) => ['suppliers', 'detail', id] as const,
};

export function useSuppliers(params: SupplierListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: supplierKeys.list(params),
    queryFn: () =>
      api<Page<SupplierListItem>>(
        `/suppliers?${toQueryString({
          q: params.q,
          category: params.category,
          page: params.page,
          pageSize: params.pageSize ?? 25,
        })}`,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useSupplier(id: string) {
  return useQuery({ queryKey: supplierKeys.detail(id), queryFn: () => api<Supplier>(`/suppliers/${id}`) });
}

export function useSaveSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<SupplierInput> }) =>
      id
        ? api<Supplier>(`/suppliers/${id}`, { method: 'PATCH', json: body })
        : api<Supplier>('/suppliers', { method: 'POST', json: body }),
    onSuccess: (fornecedor) => {
      queryClient.setQueryData(supplierKeys.detail(fornecedor.id), fornecedor);
      void queryClient.invalidateQueries({ queryKey: ['suppliers', 'list'] });
    },
  });
}

export function useDeleteSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/suppliers/${id}`, { method: 'DELETE' }),
    // só as LISTAS: a ficha do fornecedor apagado ainda está montada e rebuscá-la daria 404 à toa;
    // as peças também, porque as que o tinham como preferido ficaram sem preferido
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['parts'] });
    },
  });
}
