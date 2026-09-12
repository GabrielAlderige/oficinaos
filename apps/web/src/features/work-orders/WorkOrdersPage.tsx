import { formatBRL, WORK_ORDER_STATUS_LABELS, WORK_ORDER_STATUSES, type WorkOrderStatus } from '@oficinaos/shared';
import { ClipboardList, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PlateBadge } from '../../components/plate-badge';
import { Button } from '../../components/ui/button';
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Select } from '../../components/ui/field';
import { EmptyState, Pagination, SearchInput } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { withParam } from '../../lib/search-params';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useWorkOrderBoard, useWorkOrders, type WorkOrderListParams } from './api';
import { PaymentBadge, StatusBadge } from './status';

const GRID = 'md:grid-cols-[4.5rem_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)_8rem]';

/** Atalhos do quadro: as situações que a oficina olha o dia inteiro. */
const QUICK: (WorkOrderStatus | 'active')[] = ['active', 'AWAITING_APPROVAL', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED'];

function isStatus(value: string | null): value is WorkOrderStatus | 'active' | 'all' {
  return value === 'active' || value === 'all' || (WORK_ORDER_STATUSES as readonly string[]).includes(value ?? '');
}

export function WorkOrdersPage() {
  const canWrite = useCan('work_orders:write');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const statusParam = params.get('status');
  const status: WorkOrderListParams['status'] = isStatus(statusParam) ? statusParam : 'active';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(search.trim(), 300);

  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    setParams(withParam(params, 'q', q), { replace: true });
  }, [q, params, setParams]);

  const orders = useWorkOrders({ q, status, page });
  const board = useWorkOrderBoard();
  const data = orders.data;
  const countOf = (value: WorkOrderStatus | 'active') =>
    value === 'active' ? board.data?.activeTotal : board.data?.counts.find((c) => c.status === value)?.count;

  return (
    <>
      <PageHeader
        title="Ordens de serviço"
        description="Os carros que estão na oficina, e o que falta em cada um."
        actions={
          canWrite && (
            <Button asChild>
              <Link to="/ordens/nova">
                <Plus />
                Nova OS
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK.map((value) => {
          const count = countOf(value);
          const active = status === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setParams(withParam(params, 'status', value === 'active' ? null : value))}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-accent bg-accent-soft font-medium text-accent dark:border-accent-bright dark:text-accent-bright'
                  : 'border-border text-muted hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {value === 'active' ? 'Na oficina' : WORK_ORDER_STATUS_LABELS[value]}
              {count !== undefined && <span className="ml-1.5 tabular">{count}</span>}
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Número da OS, placa ou nome do cliente"
            label="Buscar ordens de serviço"
            className="flex-1"
            autoFocus
          />
          <div className="sm:w-56">
            <Select
              aria-label="Situação"
              value={status}
              onChange={(event) => setParams(withParam(params, 'status', event.target.value === 'active' ? null : event.target.value))}
            >
              <option value="active">Na oficina</option>
              <option value="all">Todas</option>
              {WORK_ORDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {WORK_ORDER_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {orders.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : orders.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(orders.error)}</Alert>
          </div>
        ) : !data?.data.length ? (
          q || status !== 'active' ? (
            <EmptyState
              icon={ClipboardList}
              title={q ? `Nada encontrado para “${q}”` : 'Nenhuma OS nesta situação'}
              description="Tente pelo número da OS, pela placa ou pelo nome do cliente."
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="Nenhum carro na oficina"
              description="Abra a OS a partir da placa: cliente e veículo vêm preenchidos, e o orçamento sai daí."
              action={canWrite && <Button asChild><Link to="/ordens/nova">Abrir a primeira OS</Link></Button>}
            />
          )
        ) : (
          <>
            <div className={cn('hidden gap-4 border-b border-border px-5 py-2 text-xs font-medium text-muted md:grid', GRID)}>
              <span>OS</span>
              <span>Cliente</span>
              <span>Veículo</span>
              <span>Situação</span>
              <span className="text-right">Total</span>
            </div>
            <ul className={orders.isPlaceholderData ? 'divide-y divide-border opacity-60' : 'divide-y divide-border'}>
              {data.data.map((order) => (
                <li key={order.id}>
                  <Link to={`/ordens/${order.number}`} className={cn('grid gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-muted/60 md:items-center', GRID)}>
                    <span className="text-sm font-semibold tabular">#{order.number}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{order.customerName}</span>
                      <span className="block truncate text-xs text-muted">
                        Aberta em {formatDate(order.openedAt)}
                        {order.mechanicName && ` · ${order.mechanicName}`}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <PlateBadge plate={order.vehiclePlate} size="sm" />
                      <span className="truncate text-sm text-muted">{order.vehicleName}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={order.status} />
                      <PaymentBadge status={order.paymentStatus} />
                    </span>
                    <span className="text-sm font-medium tabular md:text-right">{formatBRL(order.totalCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination meta={data.meta} onPageChange={(next) => setParams(withParam(params, 'page', String(next)))} />
          </>
        )}
      </Card>
    </>
  );
}
