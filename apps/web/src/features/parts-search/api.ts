import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PartSearchProviderId,
  PartSearchResult,
  PriceList,
  PriceListImportResult,
  WorkOrder,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';

export const partsSearchKeys = {
  all: ['parts-search'] as const,
  result: (id: string) => ['parts-search', 'result', id] as const,
  priceList: (supplierId: string, params: { q: string; page: number }) =>
    ['parts-search', 'price-list', supplierId, params] as const,
};

export interface BuscaBody {
  q: string;
  vehicleId: string | null;
  providers: PartSearchProviderId[];
}

/**
 * A busca é um POST porque **grava**: cada consulta fica registrada com as
 * ofertas e a hora. É o que permite dizer, meses depois, de onde veio o custo
 * daquela peça na OS.
 */
export function useSearchParts() {
  return useMutation({
    mutationFn: (body: BuscaBody) => api<PartSearchResult>('/parts-search', { method: 'POST', json: body }),
  });
}

export function useAddOfferToWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, ...body }: { offerId: string; workOrderId: string; quantity: number; unitPriceCents: number | null; isOptional: boolean }) =>
      api<WorkOrder>(`/parts-search/offers/${offerId}/add-to-work-order`, { method: 'POST', json: body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['parts'] });
    },
  });
}

export function usePriceList(supplierId: string, params: { q: string; page: number }, enabled = true) {
  return useQuery({
    queryKey: partsSearchKeys.priceList(supplierId, params),
    queryFn: () =>
      api<PriceList>(`/suppliers/${supplierId}/price-list?${toQueryString({ q: params.q, page: params.page, pageSize: 25 })}`),
    enabled,
  });
}

export function useImportPriceList(supplierId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { csv: string; replace: boolean }) =>
      api<PriceListImportResult>(`/suppliers/${supplierId}/price-list`, { method: 'POST', json: body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['parts-search', 'price-list'] });
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
}
