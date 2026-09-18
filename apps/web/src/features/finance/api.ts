import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CashFlow,
  CashFlowStep,
  CreateFinancialEntryInput,
  DashboardPeriod,
  FinancialCategory,
  FinancialDirection,
  FinancialEntry,
  FinancialEntryDetail,
  FinancialList,
  FinancialListFilter,
  PaymentMethod,
  ProfitReport,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { toQueryString } from '../customers/api';

export interface FinanceListParams {
  direction: FinancialDirection;
  filter: FinancialListFilter;
  q: string;
  page: number;
  pageSize?: number;
}

export interface FinancePeriodParams {
  period: DashboardPeriod;
  from?: string;
  to?: string;
  step?: CashFlowStep;
}

export const financeKeys = {
  all: ['finance'] as const,
  list: (params: FinanceListParams) => ['finance', 'list', params] as const,
  detail: (id: string) => ['finance', 'detail', id] as const,
  categories: ['finance', 'categories'] as const,
  cashFlow: (params: FinancePeriodParams) => ['finance', 'cash-flow', params] as const,
  profit: (params: FinancePeriodParams) => ['finance', 'profit', params] as const,
};

export function useFinancialEntries(params: FinanceListParams) {
  return useQuery({
    queryKey: financeKeys.list(params),
    queryFn: () =>
      api<FinancialList>(
        `/finance/entries?${toQueryString({
          direction: params.direction,
          filter: params.filter,
          q: params.q,
          page: params.page,
          pageSize: params.pageSize ?? 25,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useFinancialEntry(id: string | null) {
  return useQuery({
    queryKey: financeKeys.detail(id ?? 'nenhum'),
    queryFn: () => api<FinancialEntryDetail>(`/finance/entries/${id!}`),
    enabled: Boolean(id),
  });
}

export function useFinancialCategories() {
  return useQuery({
    queryKey: financeKeys.categories,
    queryFn: () => api<{ data: FinancialCategory[] }>('/finance/categories'),
    select: (res) => res.data,
    staleTime: 5 * 60_000,
  });
}

export function useCashFlow(params: FinancePeriodParams) {
  return useQuery({
    queryKey: financeKeys.cashFlow(params),
    queryFn: () =>
      api<CashFlow>(
        `/finance/cash-flow?${toQueryString({ period: params.period, from: params.from, to: params.to, step: params.step ?? 'day' })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useProfit(params: FinancePeriodParams) {
  return useQuery({
    queryKey: financeKeys.profit(params),
    queryFn: () =>
      api<ProfitReport>(`/finance/profit?${toQueryString({ period: params.period, from: params.from, to: params.to })}`),
    placeholderData: keepPreviousData,
  });
}

/**
 * Dinheiro mexe em muita tela: a lista das duas direções, a ficha do
 * lançamento, a OS (quando a baixa é pagamento), o fluxo de caixa e o lucro.
 * Depois de qualquer gravação, tudo isso é relido.
 */
function useRefresh() {
  const queryClient = useQueryClient();
  return (detalhe?: FinancialEntryDetail) => {
    if (detalhe) queryClient.setQueryData(financeKeys.detail(detalhe.id), detalhe);
    void queryClient.invalidateQueries({ queryKey: ['finance'] });
    void queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['payments'] });
    void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  };
}

export type EntryBody = Omit<CreateFinancialEntryInput, 'customerId' | 'supplierId'> & {
  customerId: string | null;
  supplierId: string | null;
};

export function useCreateEntry() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: EntryBody) => api<{ data: FinancialEntry[] }>('/finance/entries', { method: 'POST', json: body }),
    onSuccess: () => refresh(),
  });
}

export function useUpdateEntry(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Partial<EntryBody>) =>
      api<FinancialEntryDetail>(`/finance/entries/${id}`, { method: 'PATCH', json: body }),
    onSuccess: (detalhe) => refresh(detalhe),
  });
}

export function useCancelEntry(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (reason: string) =>
      api<FinancialEntryDetail>(`/finance/entries/${id}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: (detalhe) => refresh(detalhe),
  });
}

export function useSplitEntry(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { installments: number; firstDueDate: string | null }) =>
      api<{ data: FinancialEntry[] }>(`/finance/entries/${id}/installments`, { method: 'POST', json: body }),
    onSuccess: () => refresh(),
  });
}

export function useSettleEntry(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: {
      clientRequestId: string;
      amountCents: number;
      method: PaymentMethod;
      paidAt: string | null;
      notes: string;
    }) => api<FinancialEntryDetail>(`/finance/entries/${id}/settlements`, { method: 'POST', json: body }),
    onSuccess: (detalhe) => refresh(detalhe),
  });
}

export function useCancelSettlement() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<FinancialEntryDetail>(`/finance/settlements/${id}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: (detalhe) => refresh(detalhe),
  });
}
