import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TrackingLinkResult,
  Attachment,
  CreateUploadInput,
  Inspection,
  Page,
  UploadTicket,
  WorkOrder,
  WorkOrderAction,
  WorkOrderBoard,
  WorkOrderEvent,
  WorkOrderItemInput,
  WorkOrderListItem,
  WorkOrderStatus,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';

export interface WorkOrderListParams {
  q: string;
  status: WorkOrderStatus | 'active' | 'all';
  mechanicId?: string;
  page: number;
  pageSize?: number;
}

export const workOrderKeys = {
  all: ['work-orders'] as const,
  list: (params: WorkOrderListParams) => ['work-orders', 'list', params] as const,
  board: ['work-orders', 'board'] as const,
  detail: (number: number) => ['work-orders', 'detail', number] as const,
  timeline: (id: string) => ['work-orders', id, 'timeline'] as const,
  inspections: (id: string) => ['work-orders', id, 'inspections'] as const,
  attachments: (id: string) => ['work-orders', id, 'attachments'] as const,
};

export function useWorkOrders(params: WorkOrderListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: workOrderKeys.list(params),
    queryFn: () =>
      api<Page<WorkOrderListItem>>(
        `/work-orders?${toQueryString({
          q: params.q,
          status: params.status,
          mechanicId: params.mechanicId,
          page: params.page,
          pageSize: params.pageSize ?? 25,
        })}`,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useWorkOrderBoard(enabled = true) {
  return useQuery({ queryKey: workOrderKeys.board, queryFn: () => api<WorkOrderBoard>('/work-orders/board'), enabled });
}

export function useWorkOrder(number: number) {
  return useQuery({
    queryKey: workOrderKeys.detail(number),
    queryFn: () => api<WorkOrder>(`/work-orders/${number}`),
    enabled: Number.isFinite(number) && number > 0,
  });
}

export function useTimeline(id: string) {
  return useQuery({
    queryKey: workOrderKeys.timeline(id),
    queryFn: async () => (await api<{ data: WorkOrderEvent[] }>(`/work-orders/${id}/timeline`)).data,
    enabled: Boolean(id),
  });
}

/**
 * "Veículo pronto": a API devolve a mensagem pronta e o link wa.me. Quem aperta
 * enviar é a pessoa da oficina — nada sai sozinho (V1, sem API do WhatsApp).
 */
export function useVehicleReady(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ message: string; whatsappUrl: string | null }>(`/work-orders/${id}/vehicle-ready`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workOrderKeys.timeline(id) }),
  });
}

export function useInspections(id: string) {
  return useQuery({
    queryKey: workOrderKeys.inspections(id),
    queryFn: async () => (await api<{ data: Inspection[] }>(`/work-orders/${id}/inspections`)).data,
    enabled: Boolean(id),
  });
}

export function useAttachments(id: string) {
  return useQuery({
    queryKey: workOrderKeys.attachments(id),
    queryFn: async () => (await api<{ data: Attachment[] }>(`/work-orders/${id}/attachments`)).data,
    enabled: Boolean(id),
  });
}

/**
 * Toda mutação da OS devolve o agregado inteiro (com totais recalculados pela
 * API): guardar a resposta é o que faz o total aparecer "ao vivo" sem buscar de
 * novo. A timeline muda junto, então é invalidada.
 */
function useWorkOrderMutation<V>(mutationFn: (variables: V) => Promise<WorkOrder>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (order) => {
      queryClient.setQueryData(workOrderKeys.detail(order.number), order);
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.timeline(order.id) });
      void queryClient.invalidateQueries({ queryKey: ['work-orders', 'list'] });
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.board });
    },
  });
}

export const useCreateWorkOrder = () =>
  useWorkOrderMutation((body: Record<string, unknown>) => api<WorkOrder>('/work-orders', { method: 'POST', json: body }));

export const useUpdateWorkOrder = (id: string) =>
  useWorkOrderMutation((body: Record<string, unknown>) => api<WorkOrder>(`/work-orders/${id}`, { method: 'PATCH', json: body }));

export const useAddItem = (id: string) =>
  useWorkOrderMutation((body: WorkOrderItemInput) => api<WorkOrder>(`/work-orders/${id}/items`, { method: 'POST', json: body }));

export const useUpdateItem = (id: string) =>
  useWorkOrderMutation(({ itemId, ...body }: { itemId: string } & Record<string, unknown>) =>
    api<WorkOrder>(`/work-orders/${id}/items/${itemId}`, { method: 'PATCH', json: body }),
  );

export const useRemoveItem = (id: string) =>
  useWorkOrderMutation((itemId: string) => api<WorkOrder>(`/work-orders/${id}/items/${itemId}`, { method: 'DELETE' }));

export const useReorderItems = (id: string) =>
  useWorkOrderMutation((itemIds: string[]) =>
    api<WorkOrder>(`/work-orders/${id}/items/order`, { method: 'PUT', json: { itemIds } }),
  );

/** O link "acompanhe seu veículo" (E17): a OS não muda, só o token nasce. */
export function useTrackingLink(id: string) {
  return useMutation({
    mutationFn: () => api<TrackingLinkResult>(`/work-orders/${id}/tracking-link`, { method: 'POST' }),
  });
}

/** Cronômetro do item de serviço (E15): a OS volta inteira, com o tempo somado. */
export const useStartItemTimer = (id: string, _number: number) =>
  useWorkOrderMutation((itemId: string) =>
    api<WorkOrder>(`/work-orders/${id}/items/${itemId}/timer/start`, { method: 'POST' }),
  );

export const useStopItemTimer = (id: string, _number: number) =>
  useWorkOrderMutation((itemId: string) =>
    api<WorkOrder>(`/work-orders/${id}/items/${itemId}/timer/stop`, { method: 'POST' }),
  );

/** Ações de status: cada uma é uma rota própria (docs/API.md §1). */
export const useRunAction = (id: string) =>
  useWorkOrderMutation(({ action, reason }: { action: WorkOrderAction; reason?: string }) =>
    api<WorkOrder>(`/work-orders/${id}/${action}`, { method: 'POST', json: reason ? { reason } : undefined }),
  );

export function useAddNote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api<WorkOrderEvent>(`/work-orders/${id}/notes`, { method: 'POST', json: { text } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workOrderKeys.timeline(id) }),
  });
}

export function useCreateInspection(id: string, number: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Inspection>(`/work-orders/${id}/inspections`, { method: 'POST', json: body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.inspections(id) });
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.timeline(id) });
      // o check-in atualiza o km da OS e do veículo
      void queryClient.invalidateQueries({ queryKey: workOrderKeys.detail(number) });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

/**
 * Envio de foto/documento em três passos (ARCHITECTURE §11):
 * 1. a API cria o anexo e devolve a URL assinada;
 * 2. o navegador envia o arquivo DIRETO para essa URL — `fetch` cru, sem
 *    `api()`: não é JSON e a assinatura da URL é a credencial;
 * 3. a API confere tamanho e tipo e marca como pronto.
 */
export function useUploadFile(workOrderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, ...rest }: { file: File } & Partial<CreateUploadInput>) => {
      const ticket = await api<UploadTicket>('/uploads', {
        method: 'POST',
        json: {
          kind: file.type === 'application/pdf' ? 'DOCUMENT' : 'PHOTO',
          mimeType: file.type,
          sizeBytes: file.size,
          fileName: file.name,
          workOrderId,
          ...rest,
        },
      });
      const sent = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type },
      });
      if (!sent.ok) throw new Error('Falha ao enviar o arquivo');
      return api<Attachment>(`/uploads/${ticket.attachment.id}/complete`, { method: 'POST' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workOrderKeys.attachments(workOrderId) }),
  });
}

export function useDeleteAttachment(workOrderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => api<void>(`/uploads/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workOrderKeys.attachments(workOrderId) }),
  });
}
