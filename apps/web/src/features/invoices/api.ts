import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FiscalSettings,
  Invoice,
  InvoicePreview,
  IssueInvoiceInput,
  Page,
  UpdateFiscalSettingsInput,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';

export const invoiceKeys = {
  list: (filtro: Record<string, unknown>) => ['invoices', filtro] as const,
  detail: (id: string) => ['invoices', id] as const,
  byWorkOrder: (workOrderId: string) => ['invoices', 'work-order', workOrderId] as const,
  preview: (workOrderId: string) => ['invoices', 'preview', workOrderId] as const,
  settings: ['fiscal-settings'] as const,
};

export function useInvoices(filtro: { q?: string; status?: string; page?: number }) {
  return useQuery({
    queryKey: invoiceKeys.list(filtro),
    queryFn: () => api<Page<Invoice>>(`/invoices?${toQueryString(filtro)}`),
  });
}

export function useInvoicesOfWorkOrder(workOrderId: string, enabled = true) {
  return useQuery({
    queryKey: invoiceKeys.byWorkOrder(workOrderId),
    queryFn: () => api<{ data: Invoice[] }>(`/work-orders/${workOrderId}/invoices`),
    enabled,
  });
}

/**
 * A prévia é buscada só quando a oficina abre o diálogo de emitir: ela relê a
 * OS, o cliente e a configuração fiscal para dizer o que ainda falta, e isso
 * não precisa acontecer a cada abertura da OS.
 */
export function useInvoicePreview(workOrderId: string, enabled: boolean) {
  return useQuery({
    queryKey: invoiceKeys.preview(workOrderId),
    queryFn: () => api<InvoicePreview>(`/work-orders/${workOrderId}/invoices/preview`),
    enabled,
    staleTime: 0,
  });
}

function useInvoiceMutation<V>(mutationFn: (variables: V) => Promise<Invoice>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    },
  });
}

export const useIssueInvoice = (workOrderId: string) =>
  useInvoiceMutation((body: IssueInvoiceInput) =>
    api<Invoice>(`/work-orders/${workOrderId}/invoices`, { method: 'POST', json: body }),
  );

export const useCancelInvoice = (id: string) =>
  useInvoiceMutation((reason: string) => api<Invoice>(`/invoices/${id}/cancel`, { method: 'POST', json: { reason } }));

export function useFiscalSettings() {
  return useQuery({ queryKey: invoiceKeys.settings, queryFn: () => api<FiscalSettings>('/fiscal-settings') });
}

export function useUpdateFiscalSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateFiscalSettingsInput) =>
      api<FiscalSettings>('/fiscal-settings', { method: 'PUT', json: body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.settings });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}
