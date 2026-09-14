import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatedSupplierQuote, IssuedSupplierLink, SupplierQuote, SupplierQuoteListItem } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export const supplierQuoteKeys = {
  all: ['supplier-quotes'] as const,
  ofWorkOrder: (workOrderId: string) => ['supplier-quotes', 'work-order', workOrderId] as const,
  detail: (id: string) => ['supplier-quotes', 'detail', id] as const,
};

export function useWorkOrderSupplierQuotes(workOrderId: string, enabled = true) {
  return useQuery({
    queryKey: supplierQuoteKeys.ofWorkOrder(workOrderId),
    queryFn: () => api<{ data: SupplierQuoteListItem[] }>(`/work-orders/${workOrderId}/supplier-quotes`),
    select: (res) => res.data,
    enabled,
  });
}

/**
 * A resposta do fornecedor chega por fora da tela (pelo link dele). Enquanto a
 * cotação está aberta, relê de tempos em tempos para o quadro não ficar parado.
 */
export function useSupplierQuote(id: string) {
  return useQuery({
    queryKey: supplierQuoteKeys.detail(id),
    queryFn: () => api<SupplierQuote>(`/supplier-quotes/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'OPEN' && !query.state.data.expired ? 30_000 : false),
  });
}

/**
 * Criar, reenviar, cancelar e escolher mexem na OS (timeline e, na escolha, o
 * custo dos itens em rascunho): a ficha da OS e as cotações são relidas.
 */
function useRefresh() {
  const queryClient = useQueryClient();
  return (quote?: SupplierQuote) => {
    if (quote) queryClient.setQueryData(supplierQuoteKeys.detail(quote.id), quote);
    void queryClient.invalidateQueries({ queryKey: ['supplier-quotes', 'work-order'] });
    void queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  };
}

export function useCreateSupplierQuote() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: {
      workOrderId: string;
      workOrderItemIds: string[];
      supplierIds: string[];
      includeVin: boolean;
      message: string;
      expiresInHours: number;
    }) => api<CreatedSupplierQuote>('/supplier-quotes', { method: 'POST', json: body }),
    onSuccess: ({ quote }) => refresh(quote),
  });
}

export function useReissueSupplierLink(quoteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      api<IssuedSupplierLink>(`/supplier-quotes/${quoteId}/invites/${inviteId}/reissue`, { method: 'POST', json: {} }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: supplierQuoteKeys.detail(quoteId) }),
  });
}

export function useCancelSupplierQuote(quoteId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (reason: string) => api<SupplierQuote>(`/supplier-quotes/${quoteId}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: (quote) => refresh(quote),
  });
}

export function useAwardSupplierQuote(quoteId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (awards: { requestItemId: string; responseItemId: string }[]) =>
      api<SupplierQuote>(`/supplier-quotes/${quoteId}/award`, { method: 'POST', json: { awards } }),
    onSuccess: (quote) => refresh(quote),
  });
}
