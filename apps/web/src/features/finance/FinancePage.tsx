import { formatBRL, type FinancialDirection, type FinancialListFilter } from '@oficinaos/shared';
import { Plus, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState, Pagination, SearchInput } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useFinancialEntries } from './api';
import { EntryDetailDialog } from './EntryDetailDialog';
import { EntryFormDialog } from './EntryFormDialog';
import { dataBR, origemDoLancamento, SituationBadge } from './status';

const FILTROS: { valor: FinancialListFilter; rotulo: string }[] = [
  { valor: 'open', rotulo: 'Em aberto' },
  { valor: 'overdue', rotulo: 'Vencidas' },
  { valor: 'due_soon', rotulo: 'Vencem em 7 dias' },
  { valor: 'paid', rotulo: 'Quitadas' },
  { valor: 'canceled', rotulo: 'Canceladas' },
  { valor: 'all', rotulo: 'Todas' },
];

const TEXTO = {
  RECEIVABLE: {
    titulo: 'Contas a receber',
    descricao: 'O que a oficina tem para receber: o que nasce da OS finalizada e o que você lança à mão.',
    vazio: 'Nada a receber por aqui',
    dica: 'A OS finalizada vira conta a receber sozinha. Para o resto, lance à mão.',
    novo: 'Nova conta a receber',
    noMes: 'Recebido no mês',
  },
  PAYABLE: {
    titulo: 'Contas a pagar',
    descricao: 'O que a oficina deve: as notas das compras recebidas e as despesas do mês.',
    vazio: 'Nada a pagar por aqui',
    dica: 'A nota da compra recebida vira conta a pagar sozinha. Aluguel, luz e salário você lança à mão.',
    novo: 'Nova conta a pagar',
    noMes: 'Pago no mês',
  },
} as const;

/**
 * Contas a receber e a pagar. A mesma tela para as duas direções — o ciclo é o
 * mesmo — com o resumo em cima, que é a pergunta do dia: quanto venceu, quanto
 * vence essa semana, quanto entrou no mês.
 */
function FinancePage({ direction }: { direction: FinancialDirection }) {
  const podeMexer = useCan('finance:write');
  const texto = TEXTO[direction];
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const filter = (FILTROS.find((f) => f.valor === params.get('situacao'))?.valor ?? 'open') as FinancialListFilter;
  const [busca, setBusca] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(busca.trim(), 300);
  const [criando, setCriando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    const proximo = new URLSearchParams(params);
    if (q) proximo.set('q', q);
    else proximo.delete('q');
    proximo.delete('page');
    setParams(proximo, { replace: true });
  }, [q, params, setParams]);

  const trocarFiltro = (valor: FinancialListFilter) => {
    const proximo = new URLSearchParams(params);
    if (valor === 'open') proximo.delete('situacao');
    else proximo.set('situacao', valor);
    proximo.delete('page');
    setParams(proximo, { replace: true });
  };

  const consulta = useFinancialEntries({ direction, filter, q, page });
  const dados = consulta.data;
  const resumo = dados?.summary;

  return (
    <>
      <PageHeader
        title={texto.titulo}
        description={texto.descricao}
        actions={
          <span className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link to="/financeiro/caixa">Fluxo de caixa</Link>
            </Button>
            {podeMexer && (
              <Button onClick={() => setCriando(true)}>
                <Plus />
                {texto.novo}
              </Button>
            )}
          </span>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo rotulo="Em aberto" valor={resumo?.openCents} carregando={consulta.isPending} />
        <Resumo
          rotulo="Vencidas"
          valor={resumo?.overdueCents}
          detalhe={resumo?.overdueCount ? `${resumo.overdueCount} ${resumo.overdueCount === 1 ? 'conta' : 'contas'}` : 'nenhuma'}
          alerta={Boolean(resumo?.overdueCents)}
          carregando={consulta.isPending}
        />
        <Resumo rotulo="Vencem em 7 dias" valor={resumo?.dueThisWeekCents} carregando={consulta.isPending} />
        <Resumo rotulo={texto.noMes} valor={resumo?.settledThisMonthCents} carregando={consulta.isPending} />
      </div>

      <Card>
        <div className="space-y-3 border-b border-border p-3">
          <SearchInput
            value={busca}
            onChange={setBusca}
            placeholder={direction === 'RECEIVABLE' ? 'Cliente, descrição ou número da OS' : 'Fornecedor, descrição ou número da compra'}
            label="Buscar lançamentos"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por situação">
            {FILTROS.map((opcao) => {
              const ativo = opcao.valor === filter;
              return (
                <button
                  key={opcao.valor}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => trocarFiltro(opcao.valor)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    ativo
                      ? 'border-accent-bright bg-accent-soft font-medium text-foreground'
                      : 'border-border text-muted hover:text-foreground',
                  )}
                >
                  {opcao.rotulo}
                </button>
              );
            })}
          </div>
        </div>

        {consulta.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : consulta.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(consulta.error)}</Alert>
          </div>
        ) : !dados?.data.length ? (
          <EmptyState
            icon={Wallet}
            title={q || filter !== 'open' ? 'Nenhum lançamento com esse filtro' : texto.vazio}
            description={q || filter !== 'open' ? 'Troque a situação ou limpe a busca.' : texto.dica}
            action={
              podeMexer && !q && filter === 'open' ? <Button onClick={() => setCriando(true)}>{texto.novo}</Button> : undefined
            }
          />
        ) : (
          <>
            <div className="hidden grid-cols-[6rem_minmax(0,2fr)_minmax(0,1fr)_8rem_8rem_8rem] gap-4 border-b border-border px-5 py-2 text-xs font-medium text-muted md:grid">
              <span>Vencimento</span>
              <span>Descrição</span>
              <span>{direction === 'RECEIVABLE' ? 'Cliente' : 'Fornecedor'}</span>
              <span className="text-right">Valor</span>
              <span className="text-right">Falta</span>
              <span>Situação</span>
            </div>
            <ul className={cn('divide-y divide-border', consulta.isPlaceholderData && 'opacity-60')}>
              {dados.data.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setAberto(entry.id)}
                    className="grid w-full gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-surface-muted/60 md:grid-cols-[6rem_minmax(0,2fr)_minmax(0,1fr)_8rem_8rem_8rem] md:items-center"
                  >
                    <span className="text-sm tabular">{dataBR(entry.dueDate)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{entry.description}</span>
                      <span className="block text-xs text-muted">
                        {[
                          entry.categoryName,
                          entry.installmentCount > 1 ? `parcela ${entry.installmentNumber}/${entry.installmentCount}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="truncate text-sm text-muted">{origemDoLancamento(entry)}</span>
                    <span className="text-sm font-medium tabular md:text-right">{formatBRL(entry.amountCents)}</span>
                    <span
                      className={cn(
                        'text-sm tabular md:text-right',
                        entry.situation === 'OVERDUE' ? 'font-medium text-danger' : 'text-muted',
                      )}
                    >
                      {formatBRL(entry.remainingCents)}
                    </span>
                    <span>
                      <SituationBadge situation={entry.situation} overdueDays={entry.overdueDays} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination
              meta={dados.meta}
              onPageChange={(p) =>
                setParams((atual) => {
                  const proximo = new URLSearchParams(atual);
                  proximo.set('page', String(p));
                  return proximo;
                })
              }
            />
          </>
        )}
      </Card>

      <EntryFormDialog direction={direction} open={criando} onOpenChange={setCriando} />
      <EntryDetailDialog id={aberto} onClose={() => setAberto(null)} />
    </>
  );
}

function Resumo({ rotulo, valor, detalhe, alerta, carregando }: {
  rotulo: string;
  valor?: number;
  detalhe?: string;
  alerta?: boolean;
  carregando: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-sm text-muted">{rotulo}</p>
      {carregando ? (
        <Skeleton className="mt-1 h-7 w-24" />
      ) : (
        <p className={cn('mt-1 text-xl font-semibold', alerta && 'text-danger')}>{formatBRL(valor ?? 0)}</p>
      )}
      {detalhe && <p className="mt-0.5 text-xs text-muted">{detalhe}</p>}
    </div>
  );
}

/**
 * As duas entradas do menu apontam para a mesma tela, com a direção trocada.
 * São elas que o roteador carrega: o módulo de uma rota `lazy` só pode exportar
 * componentes sem props obrigatórias (armadilha da E5).
 */
export function ReceivablesPage() {
  return <FinancePage direction="RECEIVABLE" />;
}

export function PayablesPage() {
  return <FinancePage direction="PAYABLE" />;
}
