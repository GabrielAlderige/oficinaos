import { useQuery } from '@tanstack/react-query';
import type {
  ChartMetric,
  DashboardAttention,
  DashboardChart,
  DashboardPeriod,
  DashboardSummary,
} from '@oficinaos/shared';
import { api } from '../../lib/api-client';

export interface Periodo {
  period: DashboardPeriod;
  from?: string;
  to?: string;
}

const query = (periodo: Periodo, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams({ period: periodo.period, ...extra });
  if (periodo.from) params.set('from', periodo.from);
  if (periodo.to) params.set('to', periodo.to);
  return params.toString();
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: (periodo: Periodo) => ['dashboard', 'summary', periodo] as const,
  attention: ['dashboard', 'attention'] as const,
  chart: (metric: ChartMetric, periodo: Periodo) => ['dashboard', 'chart', metric, periodo] as const,
};

export function useDashboardSummary(periodo: Periodo, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.summary(periodo),
    queryFn: () => api<DashboardSummary>(`/dashboard/summary?${query(periodo)}`),
    enabled,
  });
}

/** O painel de atenção não depende do período: é o que está travado AGORA. */
export function useAttention(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.attention,
    queryFn: () => api<DashboardAttention>('/dashboard/attention'),
    select: (resposta) => resposta.groups,
    enabled,
  });
}

export function useChart(metric: ChartMetric, periodo: Periodo, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.chart(metric, periodo),
    queryFn: () => api<DashboardChart>(`/dashboard/charts?${query(periodo, { metric })}`),
    enabled,
  });
}
