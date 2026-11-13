import {
  ANALISES_JANELA_LABELS,
  ANALISES_JANELAS,
  formatBRL,
  taxaBps,
  variacaoBps,
  type Analises,
  type AnalisesJanela,
} from '@oficinaos/shared';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useAnalises } from './api';
import { FinanceTabs } from './FinanceTabs';

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** "nov/26" a partir de "2026-11", sem passar por `Date` */
const mesCurto = (mes: string) => `${MESES_CURTOS[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
const dataCurta = (dia: string) => `${dia.slice(8)}/${dia.slice(5, 7)}/${dia.slice(2, 4)}`;
/** cobertura do estoque em palavras: acima de um ano o número exato não ajuda ninguém */
const dura = (dias: number) => (dias > 365 ? 'mais de 1 ano' : dias === 1 ? '1 dia' : `${dias} dias`);

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
const horas = (minutos: number) => {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
};
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function lerJanela(valor: string | null): AnalisesJanela {
  const n = Number(valor);
  return (ANALISES_JANELAS as readonly number[]).includes(n) ? (n as AnalisesJanela) : 3;
}

/**
 * Análises do financeiro (E51, fase 3): o painel para decidir. Indicadores do
 * período contra o mesmo trecho antes, o mês a mês dos últimos 12 meses, e os
 * rankings (serviço que dá lucro, peça que sai, produtividade da equipe).
 *
 * Tudo vem calculado na hora pelo servidor, com as regras da DRE e dos
 * relatórios — esta tela não faz conta de dinheiro, só desenha.
 */
export function AnalisesPage() {
  const [params, setParams] = useSearchParams();
  const meses = lerJanela(params.get('meses'));
  const analises = useAnalises(meses);
  const dados = analises.data;

  const trocar = (n: AnalisesJanela) =>
    setParams(
      (atual) => {
        const proximo = new URLSearchParams(atual);
        proximo.set('meses', String(n));
        return proximo;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title="Análises"
        description="O que dá lucro, quem volta, o que gira no estoque e como a equipe rende. Calculado agora, com os dados de hoje."
        actions={
          <div role="radiogroup" aria-label="Período das análises" className="flex rounded-lg border border-border p-0.5">
            {ANALISES_JANELAS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={meses === n}
                onClick={() => trocar(n)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                  meses === n ? 'bg-accent text-accent-foreground' : 'text-muted hover:text-foreground',
                )}
              >
                {ANALISES_JANELA_LABELS[n]}
              </button>
            ))}
          </div>
        }
      />
      <FinanceTabs />

      {analises.isError ? (
        <Alert variant="danger">{errorMessage(analises.error)}</Alert>
      ) : !dados ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className={cn('space-y-5 transition-opacity', analises.isFetching && 'opacity-70')}>
          <p className="text-sm text-muted">
            De {dataCurta(dados.periodo.de)} a {dataCurta(dados.periodo.ate)}, comparado com {dataCurta(dados.anterior.de)} a{' '}
            {dataCurta(dados.anterior.ate)}. Atualizado às{' '}
            {new Date(dados.geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
          </p>
          <Indicadores dados={dados} />
          <MesAMes dados={dados} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Servicos dados={dados} />
            <Pecas dados={dados} />
          </div>
          <Equipe dados={dados} />
          <ComoCalcula />
        </div>
      )}
    </>
  );
}

// ------------------------------- indicadores -------------------------------

function Variacao({ atual, anterior }: { atual: number; anterior: number }) {
  const v = variacaoBps(atual, anterior);
  if (v === null) return <span className="text-muted">sem base para comparar</span>;
  if (v === 0) return <span className="text-muted">igual ao período anterior</span>;
  return (
    <span>
      <span className={cn('font-medium', v > 0 ? 'text-success' : 'text-danger')}>
        {v > 0 ? '▲ +' : '▼ '}
        {pct(v)}
      </span>{' '}
      <span className="text-muted">vs. antes</span>
    </span>
  );
}

function Indicador({ titulo, valor, rodape }: { titulo: string; valor: ReactNode; rodape: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <h2 className="text-sm text-muted">{titulo}</h2>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{valor}</p>
      <p className="text-xs">{rodape}</p>
    </Card>
  );
}

function Indicadores({ dados }: { dados: Analises }) {
  const i = dados.indicadores;
  const retorno = taxaBps(i.clientes.voltaram.atual, i.clientes.atendidos.atual);
  const retornoAntes = taxaBps(i.clientes.voltaram.anterior, i.clientes.atendidos.anterior);
  return (
    <section aria-label="Indicadores do período" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <Indicador
        titulo="Faturado"
        valor={formatBRL(i.faturadoCents.atual)}
        rodape={<Variacao atual={i.faturadoCents.atual} anterior={i.faturadoCents.anterior} />}
      />
      <Indicador
        titulo="Ticket médio por OS"
        valor={formatBRL(i.ticketMedioCents.atual)}
        rodape={<Variacao atual={i.ticketMedioCents.atual} anterior={i.ticketMedioCents.anterior} />}
      />
      <Indicador
        titulo="OS finalizadas"
        valor={i.ordens.atual.toLocaleString('pt-BR')}
        rodape={<Variacao atual={i.ordens.atual} anterior={i.ordens.anterior} />}
      />
      <Indicador
        titulo="Clientes que voltaram"
        valor={retorno === null ? '—' : pct(retorno)}
        rodape={
          retorno === null ? (
            <span className="text-muted">nenhum cliente atendido no período</span>
          ) : (
            <span className="text-muted">
              {i.clientes.voltaram.atual} de {i.clientes.atendidos.atual} já tinham vindo antes
              {retornoAntes !== null ? ` (antes: ${pct(retornoAntes)})` : ''}
            </span>
          )
        }
      />
      <Indicador
        titulo="Giro do estoque"
        valor={
          i.estoque.giroCentesimos === null
            ? '—'
            : `${(i.estoque.giroCentesimos / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×`
        }
        rodape={
          <span className="text-muted">
            {i.estoque.giroCentesimos === null
              ? 'sem peças com estoque controlado'
              : i.estoque.diasDeEstoque === null
                ? 'nenhuma peça saiu no período'
                : `o estoque de hoje (${formatBRL(i.estoque.finalCents)}) dá para ${dura(i.estoque.diasDeEstoque)}`}
          </span>
        }
      />
      <Indicador
        titulo="Eficiência da equipe"
        valor={i.equipe.eficienciaBps === null ? '—' : pct(i.equipe.eficienciaBps)}
        rodape={
          <span className="text-muted">
            {i.equipe.eficienciaBps === null
              ? 'aparece quando o mecânico usa o cronômetro da OS'
              : `${horas(i.equipe.vendidoMin)} vendidas, ${horas(i.equipe.trabalhadoMin)} no cronômetro`}
          </span>
        }
      />
    </section>
  );
}

// -------------------------------- mês a mês --------------------------------

type MetricaMes = 'faturadoCents' | 'lucroLiquidoCents' | 'ticketMedioCents' | 'ordens';
const METRICAS_MES: Record<MetricaMes, string> = {
  faturadoCents: 'Faturado',
  lucroLiquidoCents: 'Lucro líquido',
  ticketMedioCents: 'Ticket médio',
  ordens: 'OS finalizadas',
};

function MesAMes({ dados }: { dados: Analises }) {
  const [metrica, setMetrica] = useState<MetricaMes>('faturadoCents');
  const formatar = (v: number) => (metrica === 'ordens' ? v.toLocaleString('pt-BR') : formatBRL(v));
  const pontos = dados.mesAMes.map((m) => ({ ...m, valor: m[metrica] }));
  const maior = Math.max(0, ...pontos.map((p) => p.valor));
  const menor = Math.min(0, ...pontos.map((p) => p.valor));
  const faixa = maior - menor || 1;
  // onde fica o zero, de cima para baixo: com prejuízo, as colunas descem dele
  const zero = (maior / faixa) * 100;
  const vazio = pontos.every((p) => p.valor === 0);

  return (
    <Card>
      <CardHeader
        title="Mês a mês"
        description="Os últimos 12 meses. O mês atual vai até hoje."
        action={
          <>
            <label className="sr-only" htmlFor="analises-metrica">
              O que mostrar no gráfico
            </label>
            <select
              id="analises-metrica"
              value={metrica}
              onChange={(e) => setMetrica(e.target.value as MetricaMes)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]"
            >
              {(Object.keys(METRICAS_MES) as MetricaMes[]).map((m) => (
                <option key={m} value={m}>
                  {METRICAS_MES[m]}
                </option>
              ))}
            </select>
          </>
        }
      />
      <div className="px-5 pt-8 pb-4">
        {vazio ? (
          <p className="py-12 text-center text-sm text-muted">Nada nos últimos 12 meses.</p>
        ) : (
          <>
            <div className="relative h-44 sm:h-52" aria-hidden="true">
              <div className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: `${zero}%` }} />
              <ol className="absolute inset-0 flex gap-1 sm:gap-2">
                {pontos.map((p) => {
                  const altura = (Math.abs(p.valor) / faixa) * 100;
                  const negativo = p.valor < 0;
                  return (
                    <li key={p.mes} className="group relative min-w-0 flex-1">
                      <span
                        className={cn(
                          'absolute inset-x-0 mx-auto max-w-10 transition-opacity group-hover:opacity-80',
                          negativo ? 'rounded-b bg-danger' : 'rounded-t bg-accent-bright',
                          p.parcial && 'opacity-60',
                        )}
                        style={
                          negativo
                            ? { top: `${zero}%`, height: `${altura}%` }
                            : { bottom: `${100 - zero}%`, height: `${Math.max(altura, p.valor > 0 ? 1 : 0)}%` }
                        }
                      />
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute left-1/2 z-10 hidden -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-center whitespace-nowrap shadow-md group-hover:block"
                        style={{ top: `calc(${zero}% - 3.5rem)` }}
                      >
                        <span className="block text-sm font-semibold tabular-nums">{formatar(p.valor)}</span>
                        <span className="block text-xs text-muted">
                          {mesCurto(p.mes)}
                          {p.parcial ? ' (até hoje)' : ''}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="mt-1.5 flex gap-1 sm:gap-2" aria-hidden="true">
              {pontos.map((p, i) => (
                <span
                  key={p.mes}
                  className={cn('min-w-0 flex-1 text-center text-[11px] text-muted', i % 2 === 1 && 'invisible sm:visible')}
                >
                  {mesCurto(p.mes)}
                </span>
              ))}
            </div>
          </>
        )}
        <div className="sr-only">
          <table>
            <caption>{METRICAS_MES[metrica]} mês a mês</caption>
            <tbody>
              {pontos.map((p) => (
                <tr key={p.mes}>
                  <th scope="row">{mesCurto(p.mes)}</th>
                  <td>{formatar(p.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

// -------------------------------- rankings ---------------------------------

/** Uma linha de ranking: nome e valor em cima, a barra, e o detalhe embaixo. */
function Barra({ nome, valor, fracao, detalhe }: { nome: string; valor: string; fracao: number; detalhe: ReactNode }) {
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium" title={nome}>
          {nome}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{valor}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-muted" aria-hidden="true">
        <div className="h-2 rounded-full bg-accent-bright" style={{ width: `${Math.max(fracao * 100, 1)}%` }} />
      </div>
      <p className="text-xs text-muted">{detalhe}</p>
    </li>
  );
}

const FONTE_DO_TEMPO = { cronometro: 'pelo cronômetro', catalogo: 'pelo tempo do catálogo', misto: 'cronômetro + catálogo' };

function Servicos({ dados }: { dados: Analises }) {
  const maior = Math.max(1, ...dados.servicos.map((s) => s.lucroCents));
  return (
    <Card>
      <CardHeader title="Serviços que mais dão lucro" description="Valor cobrado menos a comissão do mecânico." />
      <div className="px-5 py-4">
        {!dados.servicos.length ? (
          <p className="py-8 text-center text-sm text-muted">Nenhum serviço entregue no período.</p>
        ) : (
          <ol className="space-y-4">
            {dados.servicos.map((s) => (
              <Barra
                key={s.servico}
                nome={s.servico}
                valor={formatBRL(s.lucroCents)}
                fracao={Math.max(0, s.lucroCents) / maior}
                detalhe={
                  <>
                    {s.vezes} {s.vezes === 1 ? 'vez' : 'vezes'}
                    {s.lucroPorHoraCents !== null && s.fonteDoTempo
                      ? ` · ${formatBRL(s.lucroPorHoraCents)} por hora (${FONTE_DO_TEMPO[s.fonteDoTempo]})`
                      : ' · sem tempo cadastrado'}
                  </>
                }
              />
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function Pecas({ dados }: { dados: Analises }) {
  const maior = Math.max(1, ...dados.pecas.map((p) => p.quantidade));
  return (
    <Card>
      <CardHeader title="Peças que mais saem" description="Na OS e no balcão. E para quantos dias o estoque dá." />
      <div className="px-5 py-4">
        {!dados.pecas.length ? (
          <p className="py-8 text-center text-sm text-muted">Nenhuma peça saiu do estoque no período.</p>
        ) : (
          <ol className="space-y-4">
            {dados.pecas.map((p) => (
              <Barra
                key={p.peca}
                nome={p.peca}
                valor={`${qtd(p.quantidade)} un.`}
                fracao={p.quantidade / maior}
                detalhe={
                  <>
                    custo {formatBRL(p.custoCents)}
                    {p.saldo === null
                      ? ' · sem estoque controlado'
                      : p.diasDeEstoque === 0
                        ? ' · acabou o estoque'
                        : ` · ${qtd(p.saldo)} em estoque, dá para ${dura(p.diasDeEstoque ?? 0)}`}
                  </>
                }
              />
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function Equipe({ dados }: { dados: Analises }) {
  const maior = Math.max(1, ...dados.mecanicos.flatMap((m) => [m.vendidoMin, m.trabalhadoMin]));
  return (
    <Card>
      <CardHeader
        title="Produtividade da equipe"
        description="Horas vendidas (o tempo do catálogo dos serviços entregues) contra horas trabalhadas (o cronômetro da OS)."
        action={
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-accent-bright" aria-hidden="true" />
              Vendidas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-muted" aria-hidden="true" />
              Trabalhadas
            </span>
          </div>
        }
      />
      <div className="px-5 py-4">
        {!dados.mecanicos.length ? (
          <p className="py-8 text-center text-sm text-muted">Nenhum serviço com mecânico responsável no período.</p>
        ) : (
          <ol className="divide-y divide-border">
            {dados.mecanicos.map((m) => (
              <li key={m.mecanico} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr_7rem] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.mecanico}</p>
                  <p className="text-xs text-muted">
                    {m.servicos} {m.servicos === 1 ? 'serviço' : 'serviços'} · {formatBRL(m.faturadoCents)}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {(
                    [
                      ['Vendidas', m.vendidoMin, 'bg-accent-bright'],
                      ['Trabalhadas', m.trabalhadoMin, 'bg-muted'],
                    ] as const
                  ).map(([rotulo, minutos, cor]) => (
                    <div key={rotulo} className="flex items-center gap-2">
                      <span className="sr-only">{rotulo}:</span>
                      <div className="h-2 flex-1 rounded-full bg-surface-muted" aria-hidden="true">
                        <div className={cn('h-2 rounded-full', cor)} style={{ width: `${(minutos / maior) * 100}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums">{horas(minutos)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-sm sm:text-right">
                  {m.eficienciaBps === null ? (
                    <span className="text-xs text-muted">sem cronômetro</span>
                  ) : (
                    <>
                      <span className="font-semibold tabular-nums">{pct(m.eficienciaBps)}</span>{' '}
                      <span className="text-xs text-muted">eficiência</span>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function ComoCalcula() {
  return (
    <details className="rounded-lg border border-border bg-surface px-5 py-3 text-sm">
      <summary className="cursor-pointer font-medium">Como cada número é calculado</summary>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
        <li>
          <strong className="text-foreground">Faturado</strong>: as OS finalizadas no período (pagas ou não) mais as vendas de
          balcão, a mesma receita bruta da DRE.
        </li>
        <li>
          <strong className="text-foreground">Ticket médio</strong>: o valor das OS finalizadas dividido pela quantidade delas.
        </li>
        <li>
          <strong className="text-foreground">Clientes que voltaram</strong>: dos clientes com OS finalizada no período, os
          que já tinham uma OS antes dele.
        </li>
        <li>
          <strong className="text-foreground">Giro do estoque</strong>: o custo das peças que saíram dividido pelo estoque
          médio (a custo) do começo e do fim do período. Quanto maior, menos dinheiro parado na prateleira.
        </li>
        <li>
          <strong className="text-foreground">Eficiência</strong>: horas vendidas ÷ horas trabalhadas, só dos serviços que
          têm tempo no catálogo e foram cronometrados. Acima de 100%, a equipe fez mais rápido que o tempo cobrado.
        </li>
        <li>
          <strong className="text-foreground">Comparação</strong>: o mesmo trecho de dias, tantos meses antes.
        </li>
      </ul>
    </details>
  );
}
