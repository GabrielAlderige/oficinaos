import { formatBRL, PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderListFilter } from '@oficinaos/shared';
import { Lightbulb, Plus, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState, Pagination, SearchInput } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { usePurchaseOrders } from './api';
import { dataCurta, PurchaseStatusBadge } from './status';

const FILTROS: { valor: PurchaseOrderListFilter; rotulo: string }[] = [
  { valor: 'open', rotulo: 'Em aberto' },
  { valor: 'DRAFT', rotulo: PURCHASE_ORDER_STATUS_LABELS.DRAFT },
  { valor: 'ORDERED', rotulo: PURCHASE_ORDER_STATUS_LABELS.ORDERED },
  { valor: 'PARTIAL', rotulo: PURCHASE_ORDER_STATUS_LABELS.PARTIAL },
  { valor: 'RECEIVED', rotulo: PURCHASE_ORDER_STATUS_LABELS.RECEIVED },
  { valor: 'CANCELED', rotulo: PURCHASE_ORDER_STATUS_LABELS.CANCELED },
  { valor: 'all', rotulo: 'Todos' },
];

/**
 * Os pedidos de compra. Abre no que está em aberto — é a pergunta do dia: o
 * que falta pedir, o que está para chegar. Filtro e busca ficam na URL.
 */
export function PurchaseOrdersPage() {
  const podeComprar = useCan('purchases:write');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const status = (FILTROS.find((f) => f.valor === params.get('situacao'))?.valor ?? 'open') as PurchaseOrderListFilter;
  const [busca, setBusca] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(busca.trim(), 300);

  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    const proximo = new URLSearchParams(params);
    if (q) proximo.set('q', q);
    else proximo.delete('q');
    proximo.delete('page');
    setParams(proximo, { replace: true });
  }, [q, params, setParams]);

  const trocarFiltro = (valor: PurchaseOrderListFilter) => {
    const proximo = new URLSearchParams(params);
    if (valor === 'open') proximo.delete('situacao');
    else proximo.set('situacao', valor);
    proximo.delete('page');
    setParams(proximo, { replace: true });
  };

  const pedidos = usePurchaseOrders({ q, status, page });
  const dados = pedidos.data;

  return (
    <>
      <PageHeader
        title="Compras"
        description="Pedidos aos fornecedores: o que falta pedir, o que está para chegar e o que já entrou no estoque."
        actions={
          <span className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link to="/compras/sugestao">
                <Lightbulb />
                Sugestão de compra
              </Link>
            </Button>
            {podeComprar && (
              <Button asChild>
                <Link to="/compras/novo">
                  <Plus />
                  Novo pedido
                </Link>
              </Button>
            )}
          </span>
        }
      />
      <Card>
        <div className="space-y-3 border-b border-border p-3">
          <SearchInput value={busca} onChange={setBusca} placeholder="Número do pedido ou fornecedor" label="Buscar pedidos" />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por situação">
            {FILTROS.map((filtro) => {
              const ativo = filtro.valor === status;
              return (
                <button
                  key={filtro.valor}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => trocarFiltro(filtro.valor)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    ativo ? 'border-accent-bright bg-accent-soft font-medium text-foreground' : 'border-border text-muted hover:text-foreground',
                  )}
                >
                  {filtro.rotulo}
                </button>
              );
            })}
          </div>
        </div>

        {pedidos.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : pedidos.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(pedidos.error)}</Alert>
          </div>
        ) : !dados?.data.length ? (
          q || status !== 'open' ? (
            <EmptyState icon={ShoppingCart} title="Nenhum pedido com esse filtro" description="Troque a situação ou busque pelo número." />
          ) : (
            <EmptyState
              icon={ShoppingCart}
              title="Nenhum pedido em aberto"
              description="Crie um pedido à mão, peça as peças de uma OS ou gere os pedidos a partir de uma cotação respondida."
              action={
                podeComprar && (
                  <Button asChild>
                    <Link to="/compras/novo">Criar pedido</Link>
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <div className="hidden grid-cols-[5rem_minmax(0,2fr)_minmax(0,1fr)_7rem_6rem_9rem] gap-4 border-b border-border px-5 py-2 text-xs font-medium text-muted md:grid">
              <span>Pedido</span>
              <span>Fornecedor</span>
              <span>Para</span>
              <span className="text-right">Total</span>
              <span>Previsão</span>
              <span>Situação</span>
            </div>
            <ul className={cn('divide-y divide-border', pedidos.isPlaceholderData && 'opacity-60')}>
              {dados.data.map((pedido) => (
                <li key={pedido.id}>
                  <Link
                    to={`/compras/${pedido.id}`}
                    className="grid gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-muted/60 md:grid-cols-[5rem_minmax(0,2fr)_minmax(0,1fr)_7rem_6rem_9rem] md:items-center"
                  >
                    <span className="text-sm font-medium tabular">nº {pedido.number}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{pedido.supplierName}</span>
                      <span className="block text-xs text-muted">
                        {pedido.itemCount} {pedido.itemCount === 1 ? 'peça' : 'peças'} · criado em {formatDate(pedido.createdAt)}
                      </span>
                    </span>
                    <span className="truncate text-sm text-muted">
                      {pedido.workOrderNumbers.length ? pedido.workOrderNumbers.map((n) => `OS ${n}`).join(', ') : 'Estoque'}
                    </span>
                    <span className="text-sm font-medium tabular md:text-right">{formatBRL(pedido.totalCents)}</span>
                    <span className="text-sm text-muted tabular">{pedido.expectedOn ? dataCurta(pedido.expectedOn) : '–'}</span>
                    <span>
                      <PurchaseStatusBadge status={pedido.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination meta={dados.meta} onPageChange={(p) => setParams((atual) => {
              const proximo = new URLSearchParams(atual);
              proximo.set('page', String(p));
              return proximo;
            })} />
          </>
        )}
      </Card>
    </>
  );
}
