import { formatBRL, type CashFlowStep } from '@oficinaos/shared';
import { ArrowDownRight, ArrowUpRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { PeriodPicker, usePeriodoNaUrl } from '../../components/PeriodPicker';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useCashFlow, useFinancialEntries, useProfit } from './api';
import { EntryDetailDialog } from './EntryDetailDialog';
import { EntryFormDialog } from './EntryFormDialog';
import { FinanceTabs } from './FinanceTabs';
import { dataBR, SituationBadge } from './status';

const PASSOS: { valor: CashFlowStep; rotulo: string }[] = [
  { valor: 'day', rotulo: 'Por dia' },
  { valor: 'week', rotulo: 'Por semana' },
  { valor: 'month', rotulo: 'Por mês' },
];

/**
 * O caixa da oficina no período: o que entrou, o que saiu e o que ainda vence.
 *
 * O gráfico é próprio (D29): duas colunas por balde, entrada e saída lado a
 * lado. Os mesmos números vivem numa tabela para leitor de tela — passar o
 * mouse acrescenta, nunca é o único caminho para o valor.
 */
export function CashFlowPage() {
  const [periodo, trocarPeriodo] = usePeriodoNaUrl();
  const [lancando, setLancando] = useState(false);
  const podeMexer = useCan('finance:write');
  const [step, setStep] = useState<CashFlowStep>('day');
  const fluxo = useCashFlow({ ...periodo, step });
  const lucro = useProfit(periodo);
  const dados = fluxo.data;
  const maior = Math.max(1, ...(dados?.buckets ?? []).flatMap((b) => [b.inCents, b.outCents]));

  return (
    <>
      <PageHeader
        title="Fluxo de caixa"
        description="O dinheiro que entrou e saiu, e o que ainda vence no período."
        actions={
          <>
            <PeriodPicker idPrefix="fluxo" valor={periodo} onChange={trocarPeriodo} />
            {/* a despesa se lança aqui, que é onde ela muda alguma coisa: sem
                isso, o caixa só teria entradas e o "lucro" seria mentira */}
            {podeMexer && (
              <Button onClick={() => setLancando(true)}>
                <Plus />
                Lançar despesa
              </Button>
            )}
          </>
        }
      />
      <FinanceTabs />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile rotulo="Entrou" valor={dados?.inCents} tom="success" carregando={fluxo.isPending} />
        <Tile rotulo="Saiu" valor={dados?.outCents} tom="danger" carregando={fluxo.isPending} />
        <Tile rotulo="Saldo do período" valor={dados?.netCents} destaque carregando={fluxo.isPending} />
        <Tile
          rotulo="Ainda vence no período"
          valor={dados ? dados.expectedInCents - dados.expectedOutCents : undefined}
          detalhe={
            dados
              ? `${formatBRL(dados.expectedInCents)} a receber · ${formatBRL(dados.expectedOutCents)} a pagar`
              : undefined
          }
          carregando={fluxo.isPending}
        />
      </div>

      <Card>
        <CardHeader
          title="Entradas e saídas"
          description={dados ? `${dataBR(dados.from)} a ${dataBR(dados.to)}` : 'Carregando…'}
          action={
            <>
              <label className="sr-only" htmlFor="fluxo-passo">
                Agrupar
              </label>
              <select
                id="fluxo-passo"
                value={step}
                onChange={(event) => setStep(event.target.value as CashFlowStep)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]"
              >
                {PASSOS.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </option>
                ))}
              </select>
            </>
          }
        />
        <div className="px-5 pt-6 pb-4">
          {fluxo.isPending ? (
            <Skeleton className="h-44 w-full" />
          ) : fluxo.isError ? (
            <Alert variant="danger">{errorMessage(fluxo.error)}</Alert>
          ) : !dados?.buckets.length ? (
            <p className="py-12 text-center text-sm text-muted">Sem movimento no período.</p>
          ) : (
            <>
              <div className="flex gap-3">
                <div className="flex h-44 w-20 shrink-0 flex-col justify-between text-right text-xs text-muted tabular-nums">
                  <span>{formatBRL(maior)}</span>
                  <span>{formatBRL(Math.round(maior / 2))}</span>
                  <span>R$ 0</span>
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
                  <ol className="flex h-44 items-end gap-1" aria-hidden="true">
                    {dados.buckets.map((balde) => (
                      <li key={balde.key} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
                        <span
                          className="w-1/2 max-w-3 rounded-t bg-success"
                          style={{ height: `${Math.max((balde.inCents / maior) * 100, balde.inCents > 0 ? 2 : 0)}%` }}
                        />
                        <span
                          className="w-1/2 max-w-3 rounded-t bg-danger"
                          style={{ height: `${Math.max((balde.outCents / maior) * 100, balde.outCents > 0 ? 2 : 0)}%` }}
                        />
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-center whitespace-nowrap shadow-md group-hover:block"
                        >
                          <span className="block text-xs text-muted">{balde.label}</span>
                          <span className="block text-sm text-success">+{formatBRL(balde.inCents)}</span>
                          <span className="block text-sm text-danger">−{formatBRL(balde.outCents)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-1.5 flex gap-1" aria-hidden="true">
                    {dados.buckets.map((balde, indice) => {
                      const passo = Math.max(1, Math.ceil(dados.buckets.length / 8));
                      return (
                        <span key={balde.key} className="min-w-0 flex-1 text-center text-[11px] text-muted tabular-nums">
                          {indice % passo === 0 ? balde.label.replace('semana de ', '') : ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              <p className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-success" aria-hidden="true" /> Entrou
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-danger" aria-hidden="true" /> Saiu
                </span>
              </p>

              {/* tabela não encolhe até o 1 px do sr-only: cresce com o conteúdo
                  e fazia o celular rolar de lado. A div é que esconde. */}
              <div className="sr-only">
                <table>
                  <caption>Entradas e saídas por período</caption>
                  <tbody>
                    {dados.buckets.map((balde) => (
                      <tr key={balde.key}>
                        <th scope="row">{balde.label}</th>
                        <td>Entrou {formatBRL(balde.inCents)}</td>
                        <td>Saiu {formatBRL(balde.outCents)}</td>
                        <td>Acumulado {formatBRL(balde.runningCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Lucro estimado"
          description="Faturado no período, menos o custo das peças usadas e as despesas pagas."
        />
        <div className="px-5 py-4">
          {lucro.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : lucro.isError ? (
            <Alert variant="danger">{errorMessage(lucro.error)}</Alert>
          ) : lucro.data ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-muted">Lucro estimado</p>
                  <p className={cn('mt-1 text-3xl font-semibold', lucro.data.lucroCents < 0 && 'text-danger')}>
                    {formatBRL(lucro.data.lucroCents)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    margem de {(lucro.data.margemBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                  </p>
                </div>
                <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
                  <Conta rotulo="Faturado" valor={lucro.data.receitaCents} sinal="mais" />
                  <Conta rotulo="Peças usadas" valor={lucro.data.custoPecasCents} sinal="menos" />
                  <Conta rotulo="Despesas pagas" valor={lucro.data.despesasCents} sinal="menos" />
                </dl>
              </div>

              {lucro.data.despesasPorCategoria.length > 0 && (
                <div className="mt-5 border-t border-border pt-3">
                  <h3 className="text-[13px] font-medium">Pago no período, por categoria</h3>
                  <ul className="mt-1.5 space-y-1 text-sm">
                    {lucro.data.despesasPorCategoria.map((linha) => (
                      <li key={linha.name} className="flex justify-between gap-4">
                        <span className="min-w-0 truncate text-muted">{linha.name}</span>
                        <span className="shrink-0 tabular">{formatBRL(linha.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted">
                    A compra de peças não entra na conta do lucro: ela já está no custo da peça que saiu na OS. Contar
                    as duas descontaria a mesma peça duas vezes.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </Card>
      <DespesasEmAberto podeMexer={podeMexer} />
      <EntryFormDialog direction="PAYABLE" open={lancando} onOpenChange={setLancando} />
    </>
  );
}

function Tile({ rotulo, valor, detalhe, tom, destaque, carregando }: {
  rotulo: string;
  valor?: number;
  detalhe?: string;
  tom?: 'success' | 'danger';
  destaque?: boolean;
  carregando: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="flex items-center gap-1.5 text-sm text-muted">
        {tom === 'success' && <ArrowUpRight className="size-4 text-success" aria-hidden="true" />}
        {tom === 'danger' && <ArrowDownRight className="size-4 text-danger" aria-hidden="true" />}
        {rotulo}
      </p>
      {carregando ? (
        <Skeleton className="mt-1 h-7 w-24" />
      ) : (
        <p
          className={cn(
            'mt-1 text-xl font-semibold',
            destaque && (valor ?? 0) < 0 && 'text-danger',
            destaque && (valor ?? 0) > 0 && 'text-success',
          )}
        >
          {formatBRL(valor ?? 0)}
        </p>
      )}
      {detalhe && <p className="mt-0.5 text-xs text-muted">{detalhe}</p>}
    </div>
  );
}

function Conta({ rotulo, valor, sinal }: { rotulo: string; valor: number; sinal: 'mais' | 'menos' }) {
  return (
    <div>
      <dt className="text-xs text-muted">{rotulo}</dt>
      <dd className="tabular">
        {sinal === 'menos' ? '−' : ''}
        {formatBRL(valor)}
      </dd>
    </div>
  );
}

/**
 * As despesas que ainda não foram pagas, aqui mesmo no caixa.
 *
 * "A pagar" deixou de ser uma tela inteira (E23) — mas a despesa precisa de um
 * lugar, senão o caixa só teria entradas e o lucro estimado seria mentira.
 * Esta lista é curta de propósito: o que está em aberto, e o botão para dar
 * baixa. O histórico do que já foi pago continua no fluxo, somado em "Saiu".
 */
function DespesasEmAberto({ podeMexer }: { podeMexer: boolean }) {
  const consulta = useFinancialEntries({ direction: 'PAYABLE', filter: 'open', q: '', page: 1 });
  const [aberto, setAberto] = useState<string | null>(null);
  const contas = consulta.data?.data ?? [];

  if (!contas.length) return null;

  const total = contas.reduce((soma, conta) => soma + conta.remainingCents, 0);

  return (
    <Card className="mt-4">
      <CardHeader
        title="Despesas em aberto"
        description="O que a oficina ainda tem para pagar. Dar baixa aqui entra no caixa na hora."
        action={<span className="text-sm font-medium tabular text-danger">{formatBRL(total)}</span>}
      />
      <ul className="divide-y divide-border border-t border-border">
        {contas.slice(0, 8).map((conta) => (
          <li key={conta.id}>
            <button
              type="button"
              disabled={!podeMexer}
              onClick={() => setAberto(conta.id)}
              className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-surface-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{conta.description}</span>
                <span className="block text-xs text-muted">
                  {[conta.categoryName, `vence ${dataBR(conta.dueDate)}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-sm font-medium tabular">{formatBRL(conta.remainingCents)}</span>
                <SituationBadge situation={conta.situation} overdueDays={conta.overdueDays} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {contas.length > 8 && (
        <p className="border-t border-border px-5 py-2 text-xs text-muted">
          e mais {contas.length - 8} em aberto.
        </p>
      )}
      <EntryDetailDialog id={aberto} onClose={() => setAberto(null)} />
    </Card>
  );
}
