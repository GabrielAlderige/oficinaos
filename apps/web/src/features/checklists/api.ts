import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChecklistTemplate, ChecklistTemplateInput } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

const chave = ['checklist-templates'] as const;

/** Os modelos mudam pouco: cinco minutos sem perguntar de novo. */
export function useChecklistTemplates() {
  return useQuery({
    queryKey: chave,
    queryFn: async () => (await api<{ data: ChecklistTemplate[] }>('/checklist-templates')).data,
    staleTime: 5 * 60_000,
  });
}

function useMudanca<T>(mutationFn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => void queryClient.invalidateQueries({ queryKey: chave }) });
}

export const useSalvarChecklist = () =>
  useMudanca(({ id, input }: { id: string | null; input: ChecklistTemplateInput }) =>
    id
      ? api<ChecklistTemplate>(`/checklist-templates/${id}`, { method: 'PUT', json: input })
      : api<ChecklistTemplate>('/checklist-templates', { method: 'POST', json: input }),
  );

export const useApagarChecklist = () =>
  useMudanca((id: string) => api(`/checklist-templates/${id}`, { method: 'DELETE' }));

export const useOrdenarChecklists = () =>
  useMudanca((ids: string[]) => api('/checklist-templates/order', { method: 'POST', json: { ids } }));
