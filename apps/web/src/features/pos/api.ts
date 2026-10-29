import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PosCharge, PosSettings, StartPosChargeInput, UpdatePosSettingsInput } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export const posKeys = {
  settings: ['pos', 'settings'] as const,
  charge: (id: string) => ['pos', 'charge', id] as const,
};

export function usePosSettings(enabled = true) {
  return useQuery({ queryKey: posKeys.settings, queryFn: () => api<PosSettings>('/pos/settings'), enabled, staleTime: 60_000 });
}

export function useUpdatePosSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePosSettingsInput) => api<PosSettings>('/pos/settings', { method: 'PUT', json: body }),
    onSuccess: (dados) => queryClient.setQueryData(posKeys.settings, dados),
  });
}

/** A cobrança na maquininha; enquanto espera o cartão, pergunta a cada 2 s (a API consulta a Stone). */
export function usePosCharge(id: string | null) {
  return useQuery({
    queryKey: posKeys.charge(id ?? ''),
    queryFn: () => api<PosCharge>(`/pos/charges/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 2_000 : false),
  });
}

/** Pago na maquininha mexe no caixa da OS, na venda e no financeiro: tudo isso relê. */
function useAtualizarCaixa() {
  const queryClient = useQueryClient();
  return () => {
    for (const chave of [['payments'], ['work-orders'], ['counter-sales'], ['finance'], ['dashboard']]) {
      void queryClient.invalidateQueries({ queryKey: chave });
    }
  };
}

export function useStartPosCharge() {
  return useMutation({
    mutationFn: (body: StartPosChargeInput) => api<PosCharge>('/pos/charges', { method: 'POST', json: body }),
  });
}

export function useCancelPosCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PosCharge>(`/pos/charges/${id}/cancel`, { method: 'POST' }),
    onSuccess: (dados) => queryClient.setQueryData(posKeys.charge(dados.id), dados),
  });
}

export function useSimulatePosPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PosCharge>(`/pos/charges/${id}/simulate-paid`, { method: 'POST' }),
    onSuccess: (dados) => queryClient.setQueryData(posKeys.charge(dados.id), dados),
  });
}

export { useAtualizarCaixa };
