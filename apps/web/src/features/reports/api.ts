import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { DashboardPeriod, Report, ReportKey } from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { tokenStore } from '../../lib/auth';
import { toQueryString } from '../customers/api';

export interface ReportParams {
  key: ReportKey;
  period: DashboardPeriod;
  from?: string;
  to?: string;
}

export const reportKeys = {
  all: ['reports'] as const,
  one: (params: ReportParams) => ['reports', params] as const,
};

export function useReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.one(params),
    queryFn: () =>
      api<Report>(`/reports/${params.key}?${toQueryString({ period: params.period, from: params.from, to: params.to })}`),
    placeholderData: keepPreviousData,
  });
}

/**
 * O CSV vem da MESMA rota, com `format=csv`: um caminho só para o número que a
 * tela mostra e o que a planilha recebe. O download precisa de `fetch` cru —
 * o cliente da API devolve JSON, e aqui o corpo é um arquivo.
 */
export function useDownloadReport() {
  return useMutation({
    mutationFn: async (params: ReportParams) => {
      const token = tokenStore.get();
      const resposta = await fetch(
        `/api/v1/reports/${params.key}?${toQueryString({
          period: params.period,
          from: params.from,
          to: params.to,
          format: 'csv',
        })}`,
        { headers: token ? { authorization: `Bearer ${token}` } : {}, credentials: 'same-origin' },
      );
      if (!resposta.ok) throw new Error('Não foi possível gerar o arquivo agora.');
      const nome = /filename="([^"]+)"/.exec(resposta.headers.get('content-disposition') ?? '')?.[1] ?? 'relatorio.csv';
      const blob = await resposta.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = nome;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return nome;
    },
  });
}
