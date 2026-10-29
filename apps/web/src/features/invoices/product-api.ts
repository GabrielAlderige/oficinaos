import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueProductInvoiceInput, ProductInvoice, ProductInvoiceModel, ProductInvoicePreview } from '@oficinaos/shared';
import { api } from '../../lib/api-client';

/** De onde sai a nota de peças: uma venda de balcão OU uma OS. */
export type OrigemDaNota = { counterSaleId: string } | { workOrderId: string };

const qs = (origem: OrigemDaNota) =>
  'counterSaleId' in origem ? `counterSaleId=${origem.counterSaleId}` : `workOrderId=${origem.workOrderId}`;

export const productInvoiceKeys = {
  of: (origem: OrigemDaNota) => ['product-invoices', qs(origem)] as const,
  preview: (origem: OrigemDaNota, model: ProductInvoiceModel) => ['product-invoices', 'preview', qs(origem), model] as const,
};

export function useProductInvoices(origem: OrigemDaNota, enabled = true) {
  return useQuery({
    queryKey: productInvoiceKeys.of(origem),
    queryFn: () => api<{ data: ProductInvoice[] }>(`/product-invoices?${qs(origem)}`),
    enabled,
    // a NF-e espera a SEFAZ: pergunta de novo a cada 5 s enquanto estiver na fila
    refetchInterval: (query) => (query.state.data?.data.some((nota) => nota.status === 'QUEUED') ? 5_000 : false),
  });
}

export function useProductInvoicePreview(origem: OrigemDaNota, model: ProductInvoiceModel, enabled: boolean) {
  return useQuery({
    queryKey: productInvoiceKeys.preview(origem, model),
    queryFn: () => api<ProductInvoicePreview>(`/product-invoices/preview?${qs(origem)}&model=${model}`),
    enabled,
    staleTime: 0,
  });
}

function useNotaMutation<V>(mutationFn: (variables: V) => Promise<ProductInvoice>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['product-invoices'] }),
  });
}

export const useIssueProductInvoice = () =>
  useNotaMutation((body: IssueProductInvoiceInput) => api<ProductInvoice>('/product-invoices', { method: 'POST', json: body }));

export const useCancelProductInvoice = () =>
  useNotaMutation(({ id, reason }: { id: string; reason: string }) =>
    api<ProductInvoice>(`/product-invoices/${id}/cancel`, { method: 'POST', json: { reason } }),
  );
