import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Customer, CustomerInput, CustomerListItem, Page, VehicleListItem } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export interface CustomerListParams {
  q: string;
  page: number;
  pageSize?: number;
}

export const toQueryString = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)]),
  ).toString();

export const customerKeys = {
  all: ['customers'] as const,
  list: (params: CustomerListParams) => ['customers', 'list', params] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
  vehicles: (id: string) => ['customers', 'detail', id, 'vehicles'] as const,
};

export function useCustomers(params: CustomerListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () =>
      api<Page<CustomerListItem>>(
        `/customers?${toQueryString({ q: params.q, page: params.page, pageSize: params.pageSize ?? 25 })}`,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCustomer(id: string) {
  return useQuery({ queryKey: customerKeys.detail(id), queryFn: () => api<Customer>(`/customers/${id}`) });
}

export function useCustomerVehicles(id: string) {
  return useQuery({
    queryKey: customerKeys.vehicles(id),
    queryFn: async () => (await api<{ data: VehicleListItem[] }>(`/customers/${id}/vehicles`)).data,
  });
}

export function useSaveCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CustomerInput }) =>
      id
        ? api<Customer>(`/customers/${id}`, { method: 'PATCH', json: body })
        : api<Customer>('/customers', { method: 'POST', json: body }),
    onSuccess: (customer) => {
      queryClient.setQueryData(customerKeys.detail(customer.id), customer);
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/customers/${id}`, { method: 'DELETE' }),
    // só as LISTAS: a página do cliente apagado ainda está montada e rebuscá-la daria 404 à toa
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles', 'list'] });
    },
  });
}
