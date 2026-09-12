import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalDecision, Page, Quote, QuoteListItem, QuoteStatus, ShareChannel } from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';
import { workOrderKeys } from '../work-orders/api';

export interface QuoteListParams {
  status: QuoteStatus | 'open' | 'all';
  page: number;
  pageSize?: number;
}

export const quoteKeys = {
  all: ['quotes'] as const,
  list: (params: QuoteListParams) => ['quotes', 'list', params] as const,
  detail: (id: string) => ['quotes', 'detail', id] as const,
};

export function useQuotes(params: QuoteListParams) {
  return useQuery({
    queryKey: quoteKeys.list(params),
    queryFn: () =>
      api<Page<QuoteListItem>>(`/quotes?${toQueryString({ status: params.status, page: params.page, pageSize: params.pageSize ?? 25 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useQuote(id: string | null) {
  return useQuery({
    queryKey: quoteKeys.detail(id ?? 'nenhum'),
    queryFn: () => api<Quote>(`/quotes/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Enviar orçamento congela os itens em rascunho da OS e muda o status dela,
 * então a ficha, a timeline e as listas precisam ser relidas.
 */
export function useSendQuote(workOrderId: string, workOrderNumber: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { validityDays?: number; message?: string }) =>
      api<Quote>(`/work-orders/${workOrderId}/quotes`, { method: 'POST', json: body }),
    onSuccess: (quote) => {
      queryClient.setQueryData(quoteKeys.detail(quote.id), quote);
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.detail(workOrderNumber) });
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.timeline(workOrderId) });
      void queryClient.invalidateQueries({ queryKey: ['work-orders', 'list'] });
      void queryClient.invalidateQueries({ queryKey: quoteKeys.all });
    },
  });
}

/** Registra o canal e devolve a mensagem pronta + o link wa.me (quem envia é a pessoa). */
export function useShareQuote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channel: ShareChannel) =>
      api<{ quote: Quote; message: string; whatsappUrl: string | null }>(`/quotes/${id}/share`, {
        method: 'POST',
        json: { channel },
      }),
    onSuccess: ({ quote }) => queryClient.setQueryData(quoteKeys.detail(quote.id), quote),
  });
}

/** "O cliente disse que pode fazer": a resposta que chegou por fora do link. */
export function useManualDecision(id: string, workOrderId: string, workOrderNumber: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      decision: ApprovalDecision;
      channel: 'PHONE' | 'IN_PERSON' | 'WHATSAPP';
      approvedItemIds?: string[];
      signerName?: string;
      notes?: string;
    }) => api<Quote>(`/quotes/${id}/manual-decision`, { method: 'POST', json: body }),
    onSuccess: (quote) => {
      queryClient.setQueryData(quoteKeys.detail(quote.id), quote);
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.detail(workOrderNumber) });
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.timeline(workOrderId) });
      void queryClient.invalidateQueries({ queryKey: ['work-orders', 'list'] });
      void queryClient.invalidateQueries({ queryKey: quoteKeys.all });
    },
  });
}
