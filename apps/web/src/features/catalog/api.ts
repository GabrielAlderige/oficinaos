import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  InventorySummary,
  Movement,
  Page,
  Part,
  PartApplication,
  PartApplicationInput,
  PartCategory,
  PartInput,
  PartListItem,
  Service,
  ServiceInput,
  StockMovementInput,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';

export interface ServiceListParams {
  q: string;
  status: 'active' | 'inactive' | 'all';
  page: number;
  pageSize?: number;
}

export interface PartListParams {
  q: string;
  categoryId?: string;
  supplierId?: string;
  attention: boolean;
  page: number;
  pageSize?: number;
}

export const catalogKeys = {
  services: ['services'] as const,
  serviceList: (params: ServiceListParams) => ['services', 'list', params] as const,
  categories: ['part-categories'] as const,
  partList: (params: PartListParams) => ['parts', 'list', params] as const,
  part: (id: string) => ['parts', 'detail', id] as const,
  movements: (id: string) => ['parts', 'detail', id, 'movements'] as const,
  applications: (id: string) => ['parts', 'detail', id, 'applications'] as const,
  summary: ['inventory', 'summary'] as const,
};

// ---------------------------------------------------------------- serviços

export function useServices(params: ServiceListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: catalogKeys.serviceList(params),
    queryFn: () =>
      api<Page<Service>>(
        `/services?${toQueryString({ q: params.q, status: params.status, page: params.page, pageSize: params.pageSize ?? 25 })}`,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useSaveService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ServiceInput }) =>
      id
        ? api<Service>(`/services/${id}`, { method: 'PATCH', json: body })
        : api<Service>('/services', { method: 'POST', json: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.services }),
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/services/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.services }),
  });
}

// -------------------------------------------------------------- categorias

export function usePartCategories() {
  return useQuery({
    queryKey: catalogKeys.categories,
    queryFn: async () => (await api<{ data: PartCategory[] }>('/part-categories')).data,
  });
}

function useCategoryMutation<V>(mutationFn: (variables: V) => Promise<PartCategory>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.categories });
      void queryClient.invalidateQueries({ queryKey: ['parts'] }); // o nome da categoria aparece nas peças
    },
  });
}

export const useCreateCategory = () =>
  useCategoryMutation((name: string) => api<PartCategory>('/part-categories', { method: 'POST', json: { name } }));

export const useRenameCategory = () =>
  useCategoryMutation(({ id, name }: { id: string; name: string }) =>
    api<PartCategory>(`/part-categories/${id}`, { method: 'PATCH', json: { name } }),
  );

// ------------------------------------------------------------------- peças

export function useParts(params: PartListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: catalogKeys.partList(params),
    queryFn: () =>
      api<Page<PartListItem>>(
        `/parts?${toQueryString({
          q: params.q,
          categoryId: params.categoryId,
          supplierId: params.supplierId,
          stock: params.attention ? 'attention' : undefined,
          page: params.page,
          pageSize: params.pageSize ?? 25,
        })}`,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function usePart(id: string) {
  return useQuery({ queryKey: catalogKeys.part(id), queryFn: () => api<Part>(`/parts/${id}`) });
}

/** Depois de mexer no saldo, a lista, o resumo e as contagens por categoria mudam. */
function invalidateStockViews(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['parts', 'list'] });
  void queryClient.invalidateQueries({ queryKey: catalogKeys.summary });
  void queryClient.invalidateQueries({ queryKey: catalogKeys.categories });
}

export function useSavePart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<PartInput> }) =>
      id ? api<Part>(`/parts/${id}`, { method: 'PATCH', json: body }) : api<Part>('/parts', { method: 'POST', json: body }),
    onSuccess: (part) => {
      queryClient.setQueryData(catalogKeys.part(part.id), part);
      invalidateStockViews(queryClient);
    },
  });
}

export function useDeletePart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/parts/${id}`, { method: 'DELETE' }),
    // só as listas: a página da peça apagada ainda está montada
    onSuccess: () => invalidateStockViews(queryClient),
  });
}

// ------------------------------------------------------------------ estoque

export function usePartMovements(id: string) {
  return useQuery({
    queryKey: catalogKeys.movements(id),
    queryFn: async () => (await api<{ data: Movement[] }>(`/parts/${id}/movements`)).data,
  });
}

export function useMoveStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StockMovementInput) =>
      api<{ part: Part; movement: Movement }>('/inventory/movements', { method: 'POST', json: body }),
    onSuccess: ({ part }) => {
      queryClient.setQueryData(catalogKeys.part(part.id), part);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.movements(part.id) });
      invalidateStockViews(queryClient);
    },
  });
}

export function useInventorySummary(enabled: boolean) {
  return useQuery({
    queryKey: catalogKeys.summary,
    queryFn: () => api<InventorySummary>('/inventory/summary'),
    enabled,
  });
}

// --------------------------------------------------------------- aplicações

export function usePartApplications(id: string) {
  return useQuery({
    queryKey: catalogKeys.applications(id),
    queryFn: async () => (await api<{ data: PartApplication[] }>(`/parts/${id}/applications`)).data,
  });
}

export function useAddApplication(partId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PartApplicationInput) =>
      api<PartApplication>(`/parts/${partId}/applications`, { method: 'POST', json: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.applications(partId) }),
  });
}

export function useRemoveApplication(partId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/parts/${partId}/applications/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.applications(partId) }),
  });
}
