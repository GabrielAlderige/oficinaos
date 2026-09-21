import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BillingOverview, CancelSubscriptionInput, ChangePlanInput, StartSubscriptionInput } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export const billingKeys = { overview: ['billing'] as const };

export function useBilling(enabled = true) {
  return useQuery({ queryKey: billingKeys.overview, queryFn: () => api<BillingOverview>('/billing'), enabled });
}

/**
 * Toda mudança de assinatura mexe no que o painel inteiro mostra (o aviso de
 * bloqueio vem do `/auth/me`), então a sessão é recarregada junto.
 */
function useBillingMutation<V>(mutationFn: (variables: V) => Promise<BillingOverview>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (visao) => {
      queryClient.setQueryData(billingKeys.overview, visao);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export const useSubscribe = () =>
  useBillingMutation((body: StartSubscriptionInput) =>
    api<BillingOverview>('/billing/subscribe', { method: 'POST', json: body }),
  );

export const useChangePlan = () =>
  useBillingMutation((body: ChangePlanInput) =>
    api<BillingOverview>('/billing/change-plan', { method: 'POST', json: body }),
  );

export const useCancelSubscription = () =>
  useBillingMutation((body: CancelSubscriptionInput) =>
    api<BillingOverview>('/billing/cancel', { method: 'POST', json: body }),
  );

export const useResumeSubscription = () =>
  useBillingMutation(() => api<BillingOverview>('/billing/resume', { method: 'POST' }));
