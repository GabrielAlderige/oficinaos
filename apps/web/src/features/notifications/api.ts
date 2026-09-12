import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationList } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (limit: number) => ['notifications', limit] as const,
};

/**
 * O painel pergunta de tempos em tempos (ARCHITECTURE §8.1): no V1 não há push,
 * e a oficina precisa saber que o cliente respondeu sem ficar recarregando.
 */
export function useNotifications(limit = 20) {
  return useQuery({
    queryKey: notificationKeys.list(limit),
    queryFn: () => api<NotificationList>(`/notifications?limit=${limit}`),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<NotificationList>('/notifications/read', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/** Clicar no aviso leva ao destino e marca só aquele como lido. */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
