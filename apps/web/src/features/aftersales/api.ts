import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FollowUpList,
  Lead,
  LeadInput,
  LeadStage,
  Pipeline,
  ReviewInviteResult,
  ReviewSummary,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';

export const aftersalesKeys = {
  followUps: (filter: string) => ['follow-ups', filter] as const,
  reviews: ['reviews', 'summary'] as const,
  pipeline: (q: string) => ['leads', 'pipeline', q] as const,
};

// ------------------------------- pós-venda -------------------------------

export function useFollowUps(filter: 'today' | 'week' | 'done' | 'all') {
  return useQuery({
    queryKey: aftersalesKeys.followUps(filter),
    queryFn: () => api<FollowUpList>(`/follow-ups?${toQueryString({ filter })}`),
    // a fila é recalculada no servidor a cada abertura: não vale cache longo
    staleTime: 0,
  });
}

export function useCloseFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, acao, outcome }: { id: string; acao: 'done' | 'skip'; outcome: string }) =>
      api<{ ok: true }>(`/follow-ups/${id}/${acao}`, { method: 'POST', json: { outcome } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['follow-ups'] }),
  });
}

// ------------------------------- avaliações -------------------------------

export function useReviewSummary() {
  return useQuery({ queryKey: aftersalesKeys.reviews, queryFn: () => api<ReviewSummary>('/reviews/summary') });
}

export function useInviteReview(workOrderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<ReviewInviteResult>(`/work-orders/${workOrderId}/review-invite`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviews'] }),
  });
}

// ---------------------------------- CRM ----------------------------------

export function usePipeline(q: string) {
  return useQuery({
    queryKey: aftersalesKeys.pipeline(q),
    queryFn: () => api<Pipeline>(`/leads?${toQueryString({ q })}`),
  });
}

function useLeadMutation<V>(mutationFn: (variables: V) => Promise<Lead>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export const useCreateLead = () =>
  useLeadMutation((body: LeadInput) => api<Lead>('/leads', { method: 'POST', json: body }));

export const useUpdateLead = (id: string) =>
  useLeadMutation((body: Partial<LeadInput>) => api<Lead>(`/leads/${id}`, { method: 'PATCH', json: body }));

export const useMoveLead = (id: string) =>
  useLeadMutation((body: { stage: LeadStage; lostReason: string }) =>
    api<Lead>(`/leads/${id}/stage`, { method: 'POST', json: body }),
  );

export const useConvertLead = (id: string) =>
  useLeadMutation((customerId: string | null) =>
    api<Lead>(`/leads/${id}/convert`, { method: 'POST', json: { customerId } }),
  );
