import {
  formatReportCell,
  REPORT_PACKS,
  REPORTS,
  type ReportKey,
  type ReportPackKey,
} from '@oficinaos/shared';
import { ChartNoAxesColumn, Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { aplicarPeriodo, PeriodPicker, type Periodo } from '../../components/PeriodPicker';
import { useDownloadReport, useDownloadReportPack, useReport } from './api';

/** Colunas de número alinham à direita: é assim que a coluna se lê de cima a baixo. */
const NUMERICOS = new Set(['money', 'number', 'quantity', 'percent', 'minutes']);

/**
 * Relatórios (E15), agora em cima da tela em vez de numa página só deles.
 *
 * O motivo é o uso: ninguém "vai para os relatórios", a pessoa está no meio de
 * outra coisa e quer conferir um número. Abrir por cima devolve ela ao lugar
 * onde estava, e o menu fica com uma linha a menos.
 *
 * Um componente só desenha todos: a API manda as colunas junto com as linhas,
 * então relatório novo aparece aqui sem tela nova. O CSV sai da mesma rota — o
 * contador pede planilha, e digitar de novo o que já está na tela é como a
 * oficina perde a tarde.
 */
export function ReportsDialog() {
  const pode = useCan('reports:read');
  const [aberto, setAberto] = useState(false);
  if (!pode) return null;

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2" title="Relatórios">
          <ChartNoAxesColumn className="size-4" />
          <span className="hidden sm:inline">Relatórios</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader
          title="Relatórios"
          description="Os números da oficina, do jeito que o contador pede: na tela e em planilha."
        />
        {/* o conteúdo só monta com o popup aberto: nada é buscado antes do clique */}
        {aberto && <Conteudo />}
      </DialogContent>
    </Dialog>
  );
}

function Conteudo() {
  const [key, setKey] = useState<ReportKey>('revenue');
  /**
   * O pacote não é mostrado na tela, só baixado. Ver nove tabelas empilhadas
   * num popup não ajuda ninguém — o pacote existe para virar anexo de e-mail.
   */
  const [pacote, setPacote] = useState<ReportPackKey | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>({ period: 'month' });
  const consulta = useReport({ key, ...periodo });
  const baixar = useDownloadReport();
  const baixarPacote = useDownloadReportPack();
  const dados = consulta.data;

  const salvar = async (formato: 'csv' | 'pdf') => {
    try {
      const nome = pacote
        ? await baixarPacote.mutateAsync({ key: pacote, formato, ...periodo })
        : await baixar.mutateAsync({ key, formato, ...periodo });
      toast.success(`${nome} baixado.`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const baixando = baixar.isPending || baixarPacote.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker
          idPrefix="relatorio"
          valor={periodo}
          onChange={(patch) => setPeriodo((anterior) => aplicarPeriodo(anterior, patch))}
        />
        <span className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" loading={baixando} onClick={() => salvar('csv')}>
            <Download />
            CSV
          </Button>
          <Button variant="secondary" size="sm" loading={baixando} onClick={() => salvar('pdf')}>
            <FileText />
            PDF
          </Button>
        </span>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-medium text-muted">
          Vários relatórios num arquivo só, para mandar ao contador
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Escolher pacote de relatórios">
          {REPORT_PACKS.map((opcao) => {
            const ativo = opcao.key === pacote;
            return (
              <button
                key={opcao.key}
                type="button"
                aria-pressed={ativo}
                title={opcao.question}
                onClick={() => setPacote(ativo ? null : opcao.key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  ativo
                    ? 'border-accent-bright bg-accent-soft font-medium text-foreground'
                    : 'border-border text-muted hover:text-foreground',
                )}
              >
                {opcao.title}
              </button>
            );
          })}
        </div>
        {pacote && (
          <p className="mt-2 text-xs text-muted">
            Os botões acima vão baixar <strong>{REPORT_PACKS.find((o) => o.key === pacote)?.title}</strong>, com{' '}
            {REPORT_PACKS.find((o) => o.key === pacote)?.sections.length} seções. Clique de novo para voltar ao
            relatório sozinho.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Escolher relatório">
        {REPORTS.map((relatorio) => {
          const ativo = relatorio.key === key;
          return (
            <button
              key={relatorio.key}
              type="button"
              aria-pressed={ativo}
              title={relatorio.question}
              onClick={() => setKey(relatorio.key)}
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

      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <p className="font-medium">{dados?.title ?? 'Carregando…'}</p>
          {dados && (
            <p className="text-xs text-muted">
              {dados.question} · {dados.period.label}
            </p>
          )}
        </div>

        {consulta.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : consulta.isError ? (
          <div className="p-4">
            <Alert variant="danger">{errorMessage(consulta.error)}</Alert>
          </div>
        ) : !dados?.rows.length ? (
          <EmptyState
            icon={ChartNoAxesColumn}
            title="Nada no período"
            description={dados?.summary ?? undefined}
          />
        ) : (
          <>
            {/* a tabela rola sozinha: o popup nunca empurra a página para o lado */}
            <div className="max-h-[45vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-xs text-muted">
                    {dados.columns.map((coluna) => (
                      <th
                        key={coluna.key}
                        scope="col"
                        className={cn(
                          'px-4 py-2 font-medium',
                          NUMERICOS.has(coluna.format) ? 'text-right' : 'text-left',
                        )}
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
                          {dados.totals![coluna.key] === null
                            ? ''
                            : formatReportCell(dados.totals![coluna.key]!, coluna.format)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {dados.summary && <p className="border-t border-border px-4 py-3 text-sm text-muted">{dados.summary}</p>}
          </>
        )}
      </Card>
    </div>
  );
}
