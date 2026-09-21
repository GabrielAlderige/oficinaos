import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AutomationKey, AutomationsOverview, UpdateAutomationSettingsInput } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export const automationKeys = { overview: ['automations'] as const };

export function useAutomations() {
  return useQuery({ queryKey: automationKeys.overview, queryFn: () => api<AutomationsOverview>('/automations') });
}

function useAutomationMutation<V>(mutationFn: (variables: V) => Promise<AutomationsOverview>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (visao) => {
      queryClient.setQueryData(automationKeys.overview, visao);
      // a automação cria fila e aviso: o sino e o pós-venda mudam junto
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
    },
  });
}

export const useUpdateAutomations = () =>
  useAutomationMutation((body: UpdateAutomationSettingsInput) =>
    api<AutomationsOverview>('/automations', { method: 'PUT', json: body }),
  );

export const useRunAutomation = () =>
  useAutomationMutation((key: AutomationKey) =>
    api<AutomationsOverview>('/automations/run', { method: 'POST', json: { key } }),
  );
