import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  OrderedPurchaseOrder,
  Page,
  PartPriceHistory,
  PurchaseOrder,
  PurchaseOrderListFilter,
  PurchaseOrderListItem,
  PurchaseOrdersFromQuoteResult,
  PurchaseSuggestions,
  SupplierHistory,
  WorkOrderPurchaseLine,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';

export interface PurchaseOrderListParams {
  q: string;
  status: PurchaseOrderListFilter;
  supplierId?: string;
  page: number;
  pageSize?: number;
}

export const purchaseKeys = {
  all: ['purchase-orders'] as const,
  list: (params: PurchaseOrderListParams) => ['purchase-orders', 'list', params] as const,
  detail: (id: string) => ['purchase-orders', 'detail', id] as const,
  ofWorkOrder: (workOrderId: string) => ['purchase-orders', 'work-order', workOrderId] as const,
  suggestions: ['purchase-orders', 'suggestions'] as const,
  supplierHistory: (supplierId: string) => ['purchase-orders', 'supplier-history', supplierId] as const,
  priceHistory: (partId: string) => ['purchase-orders', 'price-history', partId] as const,
};

export function usePurchaseSuggestions() {
  return useQuery({ queryKey: purchaseKeys.suggestions, queryFn: () => api<PurchaseSuggestions>('/purchase-orders/suggestions') });
}

export function useSupplierHistory(supplierId: string) {
  return useQuery({
    queryKey: purchaseKeys.supplierHistory(supplierId),
    queryFn: () => api<SupplierHistory>(`/suppliers/${supplierId}/history`),
  });
}

export function usePartPriceHistory(partId: string, enabled: boolean) {
  return useQuery({
    queryKey: purchaseKeys.priceHistory(partId),
    queryFn: () => api<PartPriceHistory>(`/parts/${partId}/price-history`),
    select: (res) => res.data,
    enabled,
  });
}

export function usePurchaseOrders(params: PurchaseOrderListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: purchaseKeys.list(params),
    queryFn: () =>
      api<Page<PurchaseOrderListItem>>(
        `/purchase-orders?${toQueryString({
          q: params.q,
          status: params.status,
          supplierId: params.supplierId,
          page: params.page,
          pageSize: params.pageSize ?? 25,
        })}`,
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({ queryKey: purchaseKeys.detail(id), queryFn: () => api<PurchaseOrder>(`/purchase-orders/${id}`) });
}

export function useWorkOrderPurchases(workOrderId: string, enabled = true) {
  return useQuery({
    queryKey: purchaseKeys.ofWorkOrder(workOrderId),
    queryFn: () => api<{ data: WorkOrderPurchaseLine[] }>(`/work-orders/${workOrderId}/purchases`),
    select: (res) => res.data,
    enabled,
  });
}

export interface PurchaseLineBody {
  partId: string;
  quantity: number;
  unitCostCents: number;
  workOrderItemId: string | null;
}

export interface PurchaseOrderBody {
  supplierId: string;
  expectedOn: string | null;
  shippingCents: number;
  notes: string;
  items: PurchaseLineBody[];
}

/**
 * Compra mexe em muita coisa: a lista de pedidos, a OS (timeline, reserva e
 * origem da peça), o estoque e custo da peça e o quadro da cotação. Depois de
 * qualquer gravação, tudo isso é relido.
 */
function useRefresh() {
  const queryClient = useQueryClient();
  return (order?: PurchaseOrder) => {
    if (order) queryClient.setQueryData(purchaseKeys.detail(order.id), order);
    void queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'work-order'] });
    void queryClient.invalidateQueries({ queryKey: purchaseKeys.suggestions });
    void queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'supplier-history'] });
    void queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'price-history'] });
    void queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['parts'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['supplier-quotes'] });
  };
}

export function useCreatePurchaseOrder() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: PurchaseOrderBody) => api<PurchaseOrder>('/purchase-orders', { method: 'POST', json: body }),
    onSuccess: (order) => refresh(order),
  });
}

export function useUpdatePurchaseOrder(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: PurchaseOrderBody & { version: number }) =>
      api<PurchaseOrder>(`/purchase-orders/${id}`, { method: 'PATCH', json: body }),
    onSuccess: (order) => refresh(order),
  });
}

export function useOrderPurchaseOrder(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { version: number; expectedOn: string | null }) =>
      api<OrderedPurchaseOrder>(`/purchase-orders/${id}/order`, { method: 'POST', json: body }),
    onSuccess: ({ order }) => refresh(order),
  });
}

export function useCancelPurchaseOrder(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (reason: string) => api<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: (order) => refresh(order),
  });
}

export function useClosePurchaseOrder(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (reason: string) => api<PurchaseOrder>(`/purchase-orders/${id}/close`, { method: 'POST', json: { reason } }),
    onSuccess: (order) => refresh(order),
  });
}

export function useReceivePurchaseOrder(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: {
      clientRequestId: string;
      invoiceNumber: string;
      notes: string;
      shippingCents: number;
      items: { purchaseOrderItemId: string; quantity: number; unitCostCents: number }[];
    }) => api<PurchaseOrder>(`/purchase-orders/${id}/receipts`, { method: 'POST', json: body }),
    onSuccess: (order) => refresh(order),
  });
}

export function useReturnPurchaseOrder(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { clientRequestId: string; reason: string; items: { purchaseOrderItemId: string; quantity: number }[] }) =>
      api<PurchaseOrder>(`/purchase-orders/${id}/returns`, { method: 'POST', json: body }),
    onSuccess: (order) => refresh(order),
  });
}

export function usePurchaseOrdersFromQuote() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (supplierQuoteRequestId: string) =>
      api<PurchaseOrdersFromQuoteResult>('/purchase-orders/from-quote', { method: 'POST', json: { supplierQuoteRequestId } }),
    onSuccess: ({ orders }) => {
      for (const order of orders) refresh(order);
    },
  });
}
