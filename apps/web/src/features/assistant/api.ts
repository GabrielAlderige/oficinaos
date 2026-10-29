import { useMutation, useQuery } from '@tanstack/react-query';
import type { AssistantChatInput, AssistantReply, AssistantStatus } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

/** Só pergunta quando o plano tem o assistente: sem ele, a rota responde 402. */
export function useAssistantStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: () => api<AssistantStatus>('/assistant/status'),
    enabled,
    staleTime: 60_000,
  });
}

export function useAssistantChat() {
  return useMutation({
    mutationFn: (input: AssistantChatInput) => api<AssistantReply>('/assistant/chat', { method: 'POST', json: input }),
  });
}
