import {
  DASHBOARD_PERIOD_LABELS,
  DASHBOARD_PERIODS,
  formatReportCell,
  REPORTS,
  type DashboardPeriod,
  type ReportKey,
} from '@oficinaos/shared';
import { Download, FileBarChart } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useDownloadReport, useReport } from './api';

const PERIODOS = DASHBOARD_PERIODS.filter((periodo) => periodo !== 'custom');

/** Colunas de número alinham à direita: é assim que a coluna se lê de cima a baixo. */
const NUMERICOS = new Set(['money', 'number', 'quantity', 'percent', 'minutes']);

/**
 * Relatórios (E15). Um componente só desenha todos: a API manda as colunas
 * junto com as linhas, então relatório novo aparece aqui sem tela nova.
 *
 * O CSV sai da mesma rota — o contador pede planilha, e digitar de novo o que
 * já está na tela é como a oficina perde a tarde.
 */
export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const key = (REPORTS.find((relatorio) => relatorio.key === params.get('r'))?.key ?? 'revenue') as ReportKey;
  const period = (PERIODOS.find((opcao) => opcao === params.get('periodo')) ?? 'month') as DashboardPeriod;
  const consulta = useReport({ key, period });
  const baixar = useDownloadReport();
  const dados = consulta.data;

  const trocar = (chave: string, valor: string) => {
    const proximo = new URLSearchParams(params);
    proximo.set(chave, valor);
    setParams(proximo, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Os números da oficina, do jeito que o contador pede: na tela e em planilha."
        actions={
          <>
            <label className="sr-only" htmlFor="relatorio-periodo">
              Período
            </label>
            <select
              id="relatorio-periodo"
              value={period}
              onChange={(event) => trocar('periodo', event.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            >
              {PERIODOS.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {DASHBOARD_PERIOD_LABELS[opcao]}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              loading={baixar.isPending}
              onClick={async () => {
                try {
                  const nome = await baixar.mutateAsync({ key, period });
                  toast.success(`${nome} baixado.`);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              <Download />
              Baixar CSV
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Escolher relatório">
        {REPORTS.map((relatorio) => {
          const ativo = relatorio.key === key;
          return (
            <button
              key={relatorio.key}
              type="button"
              aria-pressed={ativo}
              title={relatorio.question}
              onClick={() => trocar('r', relatorio.key)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                ativo
                  ? 'border-accent-bright bg-accent-soft font-medium text-foreground'
                  : 'border-border text-muted hover:text-foreground',
              )}
            >
              {relatorio.title}
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title={dados?.title ?? 'Carregando…'}
          description={dados ? `${dados.question} · ${dados.period.label}` : undefined}
        />

        {consulta.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : consulta.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(consulta.error)}</Alert>
          </div>
        ) : !dados?.rows.length ? (
          <EmptyState icon={FileBarChart} title="Nada no período" description={dados?.summary ?? undefined} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    {dados.columns.map((coluna) => (
                      <th
                        key={coluna.key}
                        scope="col"
                        className={cn('px-4 py-2 font-medium', NUMERICOS.has(coluna.format) ? 'text-right' : 'text-left')}
                      >
                        {coluna.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dados.rows.map((linha, indice) => (
                    <tr key={indice} className="hover:bg-surface-muted/60">
                      {dados.columns.map((coluna) => (
                        <td
                          key={coluna.key}
                          className={cn('px-4 py-2', NUMERICOS.has(coluna.format) && 'text-right tabular')}
                        >
                          {formatReportCell(linha[coluna.key] ?? null, coluna.format)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {dados.totals && (
                  <tfoot>
                    <tr className="border-t border-border font-medium">
                      {dados.columns.map((coluna) => (
                        <td
                          key={coluna.key}
                          className={cn('px-4 py-2.5', NUMERICOS.has(coluna.format) && 'text-right tabular')}
                        >
                          {dados.totals![coluna.key] === null ? '' : formatReportCell(dados.totals![coluna.key]!, coluna.format)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {dados.summary && <p className="border-t border-border px-5 py-3 text-sm text-muted">{dados.summary}</p>}
          </>
        )}
      </Card>
    </>
  );
}
