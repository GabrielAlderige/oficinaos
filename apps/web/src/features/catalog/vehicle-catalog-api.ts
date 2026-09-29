import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CatalogCoverage,
  CatalogVehicle,
  CatalogVehicleRequest,
  CatalogVehicleSummary,
  CreateCatalogVehicleInput,
  Page,
  RequestCatalogVehicleInput,
  UpdateCatalogVehicleInput,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';

/** Ficha do carro (E31): catálogo da plataforma, lido por toda oficina. */
export const fichaKeys = {
  all: ['vehicle-catalog'] as const,
  busca: (q: string, rascunhos: boolean) => ['vehicle-catalog', 'busca', q, rascunhos] as const,
  ficha: (id: string) => ['vehicle-catalog', 'ficha', id] as const,
  cobertura: ['vehicle-catalog', 'cobertura'] as const,
  fila: ['vehicle-catalog', 'fila'] as const,
};

export function useCatalogCoverage() {
  return useQuery({
    queryKey: fichaKeys.cobertura,
    queryFn: () => api<CatalogCoverage>('/vehicle-catalog/coverage'),
  });
}

export function useCatalogSearch(q: string, rascunhos = false, enabled = true) {
  return useQuery({
    queryKey: fichaKeys.busca(q, rascunhos),
    queryFn: () =>
      api<Page<CatalogVehicleSummary>>(
        `/vehicle-catalog?q=${encodeURIComponent(q)}&incluirRascunhos=${rascunhos}`,
      ),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCatalogVehicle(id: string | null) {
  return useQuery({
    queryKey: fichaKeys.ficha(id ?? ''),
    queryFn: () => api<CatalogVehicle>(`/vehicle-catalog/${id}`),
    enabled: Boolean(id),
  });
}

/** "Não achei o meu carro": vira a fila de prioridade de quem preenche. */
export function useRequestVehicle() {
  return useMutation({
    mutationFn: (body: RequestCatalogVehicleInput) =>
      api<{ message: string }>('/vehicle-catalog/requests', { method: 'POST', json: body }),
  });
}

// ------------------------- só a plataforma -------------------------

export function useCatalogQueue(enabled: boolean) {
  return useQuery({
    queryKey: fichaKeys.fila,
    queryFn: () => api<{ data: CatalogVehicleRequest[] }>('/vehicle-catalog/requests/queue').then((r) => r.data),
    enabled,
  });
}

export function useSaveCatalogVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CreateCatalogVehicleInput | UpdateCatalogVehicleInput }) =>
      id
        ? api<CatalogVehicle>(`/vehicle-catalog/${id}`, { method: 'PATCH', json: body })
        : api<CatalogVehicle>('/vehicle-catalog', { method: 'POST', json: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fichaKeys.all }),
  });
}

export function useDeleteCatalogVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/vehicle-catalog/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fichaKeys.all }),
  });
}
