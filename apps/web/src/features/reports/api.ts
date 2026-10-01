import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { DashboardPeriod, Report, ReportKey, ReportPack, ReportPackKey } from '@oficinaos/shared';
import { api } from '../../lib/api-client';
import { tokenStore } from '../../lib/auth';
import { toQueryString } from '../customers/api';

export interface ReportParams {
  key: ReportKey;
  period: DashboardPeriod;
  from?: string;
  to?: string;
}

export interface ReportPackParams {
  key: ReportPackKey;
  period: DashboardPeriod;
  from?: string;
  to?: string;
}

export const reportKeys = {
  all: ['reports'] as const,
  one: (params: ReportParams) => ['reports', params] as const,
  pack: (params: ReportPackParams) => ['reports', 'pacote', params] as const,
};

export function useReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.one(params),
    queryFn: () =>
      api<Report>(`/reports/${params.key}?${toQueryString({ period: params.period, from: params.from, to: params.to })}`),
    placeholderData: keepPreviousData,
  });
}

export function useReportPack(params: ReportPackParams, enabled = true) {
  return useQuery({
    queryKey: reportKeys.pack(params),
    queryFn: () =>
      api<ReportPack>(
        `/reports/pacotes/${params.key}?${toQueryString({ period: params.period, from: params.from, to: params.to })}`,
      ),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** CSV para o contador somar; PDF para a pessoa ler e arquivar. */
export type FormatoDeArquivo = 'csv' | 'pdf';

/**
 * O arquivo vem da MESMA rota que a tela usa, trocando só `format`: um caminho
 * só para o número que aparece e o que é baixado. O download precisa de `fetch`
 * cru — o cliente da API devolve JSON, e aqui o corpo é um arquivo.
 */
async function baixarArquivo(url: string, extensao: FormatoDeArquivo): Promise<string> {
  const token = tokenStore.get();
  const resposta = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    credentials: 'same-origin',
  });
  if (!resposta.ok) throw new Error('Não foi possível gerar o arquivo agora.');
  const nome =
    /filename="([^"]+)"/.exec(resposta.headers.get('content-disposition') ?? '')?.[1] ?? `relatorio.${extensao}`;
  const blob = await resposta.blob();
  const endereco = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = endereco;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(endereco);
  return nome;
}

export function useDownloadReport() {
  return useMutation({
    mutationFn: ({ formato, ...params }: ReportParams & { formato: FormatoDeArquivo }) =>
      baixarArquivo(
        `/api/v1/reports/${params.key}?${toQueryString({
          period: params.period,
          from: params.from,
          to: params.to,
          format: formato,
        })}`,
        formato,
      ),
  });
}

export function useDownloadReportPack() {
  return useMutation({
    mutationFn: ({ formato, ...params }: ReportPackParams & { formato: FormatoDeArquivo }) =>
      baixarArquivo(
        `/api/v1/reports/pacotes/${params.key}?${toQueryString({
          period: params.period,
          from: params.from,
          to: params.to,
          format: formato,
        })}`,
        formato,
      ),
  });
}
