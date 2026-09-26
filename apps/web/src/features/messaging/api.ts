import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConnectChannelInput,
  Conversation,
  ConversationHelpers,
  ConversationSummary,
  MessagingOverview,
  SendMessageInput,
  SendMessageResult,
  UpdateAutoSendInput,
  UpdateTemplateInput,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export const messagingKeys = {
  channel: ['messaging', 'channel'] as const,
  conversations: ['messaging', 'conversations'] as const,
  conversation: (customerId: string) => ['messaging', 'conversations', customerId] as const,
  templates: (customerId: string) => ['messaging', 'conversations', customerId, 'templates'] as const,
};

// ------------------------------- o canal -----------------------------------

export function useMessagingChannel() {
  return useQuery({ queryKey: messagingKeys.channel, queryFn: () => api<MessagingOverview>('/messaging/channel') });
}

export function useConnectChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ConnectChannelInput) =>
      api<MessagingOverview>('/messaging/channel', { method: 'POST', json: body }),
    onSuccess: (visao) => {
      queryClient.setQueryData(messagingKeys.channel, visao);
      // o que a conversa oferece muda por completo quando o canal conecta
      void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
    },
  });
}

export function useDisconnectChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<MessagingOverview>('/messaging/channel', { method: 'DELETE' }),
    onSuccess: (visao) => {
      queryClient.setQueryData(messagingKeys.channel, visao);
      void queryClient.invalidateQueries({ queryKey: ['messaging', 'conversations'] });
    },
  });
}

export function useSaveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTemplateInput) =>
      api<MessagingOverview>('/messaging/templates', { method: 'PATCH', json: body }),
    onSuccess: (visao) => queryClient.setQueryData(messagingKeys.channel, visao),
  });
}

export function useUpdateAutoSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAutoSendInput) =>
      api<MessagingOverview>('/messaging/auto-send', { method: 'PUT', json: body }),
    onSuccess: (visao) => queryClient.setQueryData(messagingKeys.channel, visao),
  });
}

// ------------------------------ a conversa ---------------------------------

export function useConversations() {
  return useQuery({
    queryKey: messagingKeys.conversations,
    queryFn: () => api<ConversationSummary[]>('/messaging/conversations'),
    // o cliente responde enquanto a tela está aberta: a lista se atualiza sozinha
    refetchInterval: 60_000,
  });
}

export function useConversation(customerId: string | null) {
  return useQuery({
    queryKey: messagingKeys.conversation(customerId ?? 'nenhuma'),
    queryFn: () => api<Conversation>(`/messaging/conversations/${customerId}`),
    enabled: Boolean(customerId),
    refetchInterval: 30_000,
  });
}

/** Os modelos e as respostas prontas daquele cliente, já escritos. */
export function useMessageTemplates(customerId: string | null) {
  return useQuery({
    queryKey: messagingKeys.templates(customerId ?? 'nenhuma'),
    queryFn: () => api<ConversationHelpers>(`/messaging/conversations/${customerId}/templates`),
    enabled: Boolean(customerId),
    // o texto muda pouco (nome, carro, oficina): não precisa buscar de novo a cada abertura
    staleTime: 5 * 60_000,
  });
}

export function useSendMessage(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendMessageInput) =>
      api<SendMessageResult>(`/messaging/conversations/${customerId}/messages`, { method: 'POST', json: body }),
    onSuccess: (resultado) => {
      queryClient.setQueryData(messagingKeys.conversation(customerId), resultado.conversation);
      void queryClient.invalidateQueries({ queryKey: messagingKeys.conversations });
    },
  });
}

export function useMarkConversationRead(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<Conversation>(`/messaging/conversations/${customerId}/read`, { method: 'POST' }),
    onSuccess: (conversa) => {
      queryClient.setQueryData(messagingKeys.conversation(customerId), conversa);
      void queryClient.invalidateQueries({ queryKey: messagingKeys.conversations });
    },
  });
}
