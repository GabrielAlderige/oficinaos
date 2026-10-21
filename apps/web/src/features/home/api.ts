import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SampleDataStatus } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

/** Os dados de exemplo da oferta Oficina Pronta (D92). */
export const sampleDataKey = ['sample-data'] as const;

export function useSampleData(enabled = true) {
  return useQuery({
    queryKey: sampleDataKey,
    queryFn: () => api<SampleDataStatus>('/sample-data'),
    enabled,
  });
}

/**
 * Carregar e apagar mexem em clientes, carros e serviços de uma vez: todas as
 * listas ficam velhas, então tudo é invalidado (é raro e barato).
 */
export function useLoadSampleData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SampleDataStatus>('/sample-data', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useClearSampleData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SampleDataStatus>('/sample-data', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries(),
  });
}
