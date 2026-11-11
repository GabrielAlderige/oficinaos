import {
  EXECUTAM_SERVICO,
  formatBRL,
  WORK_ORDER_DATE_FIELD_LABELS,
  WORK_ORDER_DATE_FIELDS,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUSES,
  type WorkOrderDateField,
  type WorkOrderStatus,
} from '@oficinaos/shared';
import { ClipboardList, Columns3, List, Plus, Tv } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PeriodPicker, usePeriodoOpcionalNaUrl } from '../../components/PeriodPicker';
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
import { useMembers } from '../settings/api';
import { useWorkOrderBoard, useWorkOrders, type WorkOrderListParams } from './api';
import { PatioBoard } from './PatioBoard';
import { PaymentBadge, StatusBadge } from './status';

const GRID = 'md:grid-cols-[4.5rem_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)_8rem]';

/**
 * Atalhos do quadro: as situações que a oficina olha o dia inteiro, e as
 * entregues no fim, que é onde se procura o carro que já foi embora.
 */
const QUICK: (WorkOrderStatus | 'active')[] = ['active', 'AWAITING_APPROVAL', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'DELIVERED'];
const QUICK_LABELS: Partial<Record<WorkOrderStatus | 'active', string>> = { active: 'Na oficina', DELIVERED: 'Entregues' };

function isStatus(value: string | null): value is WorkOrderStatus | 'active' | 'all' {
  return value === 'active' || value === 'all' || (WORK_ORDER_STATUSES as readonly string[]).includes(value ?? '');
}

/** Lista ou pátio (E49): a escolha fica no endereço, para voltar nela. */
function Vistas({ patio, onChange }: { patio: boolean; onChange(patio: boolean): void }) {
  return (
    <div role="group" aria-label="Como ver" className="inline-flex rounded-lg border border-border p-0.5">
      {[
        { valor: false, rotulo: 'Lista', icone: List },
        { valor: true, rotulo: 'Pátio', icone: Columns3 },
      ].map(({ valor, rotulo, icone: Icone }) => (
        <button
          key={rotulo}
          type="button"
          aria-pressed={patio === valor}
          onClick={() => onChange(valor)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
            patio === valor ? 'bg-accent-soft font-medium text-accent dark:text-accent-bright' : 'text-muted hover:text-foreground',
          )}
        >
          <Icone className="size-4" aria-hidden="true" />
          {rotulo}
        </button>
      ))}
    </div>
  );
}

export function WorkOrdersPage() {
  const [params, setParams] = useSearchParams();
  const patio = params.get('vista') === 'patio';
  const mudarVista = (valor: boolean) => setParams(withParam(new URLSearchParams(), 'vista', valor ? 'patio' : null));

  if (patio) {
    return (
      <>
        <CabecalhoDasOrdens patio onVista={mudarVista} />
        <PatioBoard />
      </>
    );
  }
  return <ListaDeOrdens onVista={mudarVista} />;
}

function CabecalhoDasOrdens({ patio, onVista }: { patio: boolean; onVista(patio: boolean): void }) {
  const canWrite = useCan('work_orders:write');
  return (
    <PageHeader
      title="Ordens de serviço"
      description={patio ? 'O pátio: cada carro na etapa em que está. Toque no cartão para abrir a OS.' : 'Os carros que estão na oficina, e o que falta em cada um.'}
      actions={
        <span className="flex flex-wrap items-center gap-2">
          <Vistas patio={patio} onChange={onVista} />
          {patio && (
            <Button asChild variant="secondary">
              <Link to="/patio/tv">
                <Tv />
                Modo TV
              </Link>
            </Button>
          )}
          {canWrite && (
            <Button asChild>
              <Link to="/ordens/nova">
                <Plus />
                Nova OS
              </Link>
            </Button>
          )}
        </span>
      }
    />
  );
}

function ListaDeOrdens({ onVista }: { onVista(patio: boolean): void }) {
  const canWrite = useCan('work_orders:write');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [periodo, trocarPeriodo, limparPeriodo] = usePeriodoOpcionalNaUrl(null);
  const dataParam = params.get('data');
  const dateBy: WorkOrderDateField = (WORK_ORDER_DATE_FIELDS as readonly string[]).includes(dataParam ?? '')
    ? (dataParam as WorkOrderDateField)
    : 'opened';
  const mecanico = params.get('mecanico') ?? '';
  const statusParam = params.get('status');
  /**
   * Sem período, a lista abre no que está na oficina (o uso do dia a dia).
   * Com período, a pergunta é "o que passou por aqui na semana": abre em todas
   * as situações, senão as entregues somem justo quando se procura por elas.
   */
  const statusPadrao: WorkOrderListParams['status'] = periodo ? 'all' : 'active';
  const status: WorkOrderListParams['status'] = isStatus(statusParam) ? statusParam : statusPadrao;
  const trocarStatus = (valor: string) => setParams(withParam(params, 'status', valor === statusPadrao ? null : valor));
  const equipe = useMembers();
  const mecanicos = (equipe.data ?? []).filter((m) => m.isActive && EXECUTAM_SERVICO.includes(m.role));
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(search.trim(), 300);

  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    setParams(withParam(params, 'q', q), { replace: true });
  }, [q, params, setParams]);

  const orders = useWorkOrders({
    q,
    status,
    page,
    mechanicId: mecanico || undefined,
    period: periodo?.period,
    fromDay: periodo?.from,
    toDay: periodo?.to,
    dateBy,
  });
  const filtrando = Boolean(q || periodo || mecanico || status !== 'active');
  const board = useWorkOrderBoard();
  const data = orders.data;
  const countOf = (value: WorkOrderStatus | 'active') =>
    value === 'active' ? board.data?.activeTotal : board.data?.counts.find((c) => c.status === value)?.count;

  return (
    <>
      <CabecalhoDasOrdens patio={false} onVista={onVista} />

      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK.map((value) => {
          const count = countOf(value);
          const active = status === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => trocarStatus(value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-accent bg-accent-soft font-medium text-accent dark:border-accent-bright dark:text-accent-bright'
                  : 'border-border text-muted hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {QUICK_LABELS[value] ?? WORK_ORDER_STATUS_LABELS[value as WorkOrderStatus]}
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
              onChange={(event) => trocarStatus(event.target.value)}
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

        <div className="flex flex-col gap-2 border-b border-border p-3 lg:flex-row lg:items-start lg:justify-between">
          <PeriodPicker
            idPrefix="os"
            valor={periodo}
            onChange={trocarPeriodo}
            onLimpar={limparPeriodo}
            rotuloLimpar="Tudo"
          />
          <div className="flex flex-wrap gap-2 lg:shrink-0 lg:flex-nowrap">
            {periodo && (
              <div className="min-w-36 flex-1 lg:w-40 lg:flex-none">
                <Select
                  aria-label="Qual data da OS"
                  value={dateBy}
                  onChange={(event) => setParams(withParam(params, 'data', event.target.value === 'opened' ? null : event.target.value))}
                >
                  {WORK_ORDER_DATE_FIELDS.map((campo) => (
                    <option key={campo} value={campo}>
                      Por {WORK_ORDER_DATE_FIELD_LABELS[campo].toLowerCase()}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {mecanicos.length > 0 && (
              <div className="min-w-44 flex-1 lg:w-52 lg:flex-none">
                <Select
                  aria-label="Mecânico"
                  value={mecanico}
                  onChange={(event) => setParams(withParam(params, 'mecanico', event.target.value || null))}
                >
                  <option value="">Todos os mecânicos</option>
                  {mecanicos.map((membro) => (
                    <option key={membro.userId} value={membro.userId}>
                      {membro.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* a contagem do resultado ANTERIOR, mostrada enquanto o novo chega, mentia o número */}
        {data && filtrando && !orders.isPlaceholderData && (
          <p className="border-b border-border px-5 py-2 text-xs text-muted" aria-live="polite">
            {data.meta.total === 1 ? '1 OS encontrada' : `${data.meta.total} OS encontradas`}
            {periodo && dateBy !== 'opened' && ` (por data de ${WORK_ORDER_DATE_FIELD_LABELS[dateBy].toLowerCase()})`}
          </p>
        )}

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
          filtrando ? (
            <EmptyState
              icon={ClipboardList}
              title={q ? `Nada encontrado para “${q}”` : periodo ? 'Nenhuma OS neste período' : 'Nenhuma OS nesta situação'}
              description={
                periodo
                  ? 'Ande com as setas para o período anterior, troque a situação ou escolha “Tudo”.'
                  : 'Tente pelo número da OS, pela placa ou pelo nome do cliente.'
              }
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
                        {periodo && dateBy === 'delivered' && order.deliveredAt
                          ? `Entregue em ${formatDate(order.deliveredAt)}`
                          : periodo && dateBy === 'completed' && order.completedAt
                            ? `Concluída em ${formatDate(order.completedAt)}`
                            : order.deliveredAt
                              ? `Aberta em ${formatDate(order.openedAt)} · entregue em ${formatDate(order.deliveredAt)}`
                              : `Aberta em ${formatDate(order.openedAt)}`}
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
