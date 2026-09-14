import {
  CHART_METRICS,
  CHART_METRIC_LABELS,
  formatBRL,
  type ChartMetric,
  type DashboardChart,
} from '@oficinaos/shared';
import { useState } from 'react';
import { Card, CardHeader, Skeleton } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { useChart, type Periodo } from './api';

const formatarValor = (valor: number, unit: DashboardChart['unit']) => {
  if (unit === 'money') return formatBRL(valor);
  if (unit === 'percent') return `${valor}%`;
  return valor.toLocaleString('pt-BR');
};

/** "14/09" a partir da chave do dia, sem passar por `Date` (que traria o fuso do navegador). */
const diaCurto = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}`;

/** Teto redondo em cima do maior valor: 680 vira 700, 1.240 vira 1.300. */
function tetoRedondo(maior: number): number {
  if (maior <= 0) return 1;
  const casa = 10 ** Math.max(0, String(Math.round(maior)).length - 2);
  return Math.ceil(maior / casa) * casa;
}

/**
 * A série do período, uma coluna por dia (D29: SVG e HTML próprios, sem
 * biblioteca de gráfico). Uma série só, então **não há legenda** — o título já
 * diz o que está plotado, e um quadradinho de cor repetiria isso ocupando espaço.
 *
 * Os valores também vivem numa tabela escondida para leitor de tela: o passar do
 * mouse **acrescenta**, nunca é o único caminho para o número.
 */
export function MetricChart({ periodo, podeVerDinheiro }: { periodo: Periodo; podeVerDinheiro: boolean }) {
  const [metric, setMetric] = useState<ChartMetric>(podeVerDinheiro ? 'revenue' : 'work_orders');
  const grafico = useChart(metric, periodo);
  const dados = grafico.data;
  const pontos = dados?.points ?? [];
  const maior = Math.max(0, ...pontos.map((ponto) => ponto.value));
  const teto = tetoRedondo(maior);
  // no celular cabe menos data sem as legendas se encavalarem: o passo dobra,
  // e as intermediárias só aparecem a partir de `sm`
  const passo = Math.max(1, Math.ceil(pontos.length / 8));
  const passoEstreito = passo * 2;
  // rotular todo ponto vira ruído: só o maior ganha número em cima
  const diaDoMaior = pontos.find((ponto) => ponto.value === maior && maior > 0)?.day;

  const opcoes = CHART_METRICS.filter(
    (opcao) => podeVerDinheiro || (opcao !== 'revenue' && opcao !== 'avg_ticket'),
  );

  return (
    <Card>
      <CardHeader
        title={CHART_METRIC_LABELS[metric]}
        description={dados ? dados.period.label : 'Carregando…'}
        action={
          <>
            <label className="sr-only" htmlFor="grafico-metrica">
              O que mostrar no gráfico
            </label>
            <select
              id="grafico-metrica"
              value={metric}
              onChange={(event) => setMetric(event.target.value as ChartMetric)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]"
            >
              {opcoes.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {CHART_METRIC_LABELS[opcao]}
                </option>
              ))}
            </select>
          </>
        }
      />

      <div className="border-t border-border px-5 pt-6 pb-4">
        {grafico.isPending ? (
          <Skeleton className="h-44 w-full" />
        ) : !pontos.length ? (
          <p className="py-12 text-center text-sm text-muted">Sem movimento no período.</p>
        ) : (
          <>
            <div className="flex gap-3">
              {/* a régua carrega os valores que não foram rotulados direto */}
              <div className="flex h-44 w-14 shrink-0 flex-col justify-between text-right text-xs text-muted tabular-nums">
                <span>{formatarValor(teto, dados!.unit)}</span>
                <span>{formatarValor(Math.round(teto / 2), dados!.unit)}</span>
                <span>0</span>
              </div>

              <div className="relative min-w-0 flex-1">
                {[0, 50, 100].map((altura) => (
                  <div
                    key={altura}
                    className="pointer-events-none absolute inset-x-0 border-t border-border"
                    style={{ top: `${altura}%` }}
                    aria-hidden="true"
                  />
                ))}
                <ol className="flex h-44 items-end gap-0.5" aria-hidden="true">
                  {pontos.map((ponto) => {
                    const altura = teto ? (ponto.value / teto) * 100 : 0;
                    return (
                      <li
                        key={ponto.day}
                        className="group relative flex min-w-0 flex-1 justify-center"
                        style={{ height: '100%' }}
                      >
                        {/* a coluna nunca enche a faixa (máx. 24 px): a sobra é ar */}
                        <div className="relative flex h-full w-full max-w-6 items-end justify-center">
                          <span
                            className={cn(
                              'w-full rounded-t bg-accent-bright transition-opacity',
                              'group-hover:opacity-80',
                            )}
                            style={{ height: `${Math.max(altura, ponto.value > 0 ? 2 : 0)}%` }}
                          />
                          {ponto.day === diaDoMaior && (
                            <span className="absolute -top-5 text-[11px] font-medium whitespace-nowrap text-muted">
                              {formatarValor(ponto.value, dados!.unit)}
                            </span>
                          )}
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-center whitespace-nowrap shadow-md group-hover:block"
                          >
                            <span className="block text-sm font-semibold">
                              {formatarValor(ponto.value, dados!.unit)}
                            </span>
                            <span className="block text-xs text-muted">{diaCurto(ponto.day)}</span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-1.5 flex gap-0.5" aria-hidden="true">
                  {pontos.map((ponto, indice) => (
                    <span
                      key={ponto.day}
                      className={cn(
                        'min-w-0 flex-1 text-center text-[11px] text-muted tabular-nums',
                        indice % passoEstreito !== 0 && 'invisible sm:visible',
                      )}
                    >
                      {indice % passo === 0 ? diaCurto(ponto.day) : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* o mesmo dado em tabela: passar o mouse acrescenta, nunca é o único caminho */}
            <table className="sr-only">
              <caption>
                {CHART_METRIC_LABELS[metric]} por dia — {dados!.period.label}
              </caption>
              <tbody>
                {pontos.map((ponto) => (
                  <tr key={ponto.day}>
                    <th scope="row">{diaCurto(ponto.day)}</th>
                    <td>{formatarValor(ponto.value, dados!.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Card>
  );
}
