import { formatBRL, formatPlate, type WorkOrderHistoryEntry } from '@oficinaos/shared';
import { History } from 'lucide-react';
import { Link } from 'react-router';
import { Alert, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { formatKm } from '../../lib/contact';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useWorkOrderHistory } from './api';
import { StatusBadge } from './status';

/** "2 × Filtro de óleo"; a quantidade só aparece quando não é 1. */
function itemLabel(item: WorkOrderHistoryEntry['items'][number]) {
  const qtd = item.quantity === 1 ? '' : `${item.quantity.toLocaleString('pt-BR')} × `;
  return qtd + item.description;
}

/**
 * Histórico de atendimentos: cada OS com o que foi feito, a quilometragem e o
 * total. No carro, mostra só as dele; no cliente, as de todos os carros, e por
 * isso cada linha diz de qual carro é.
 */
export function ServiceHistory({
  by,
  title,
  emptyDescription,
}: {
  by: { vehicleId: string } | { customerId: string };
  title: string;
  emptyDescription: string;
}) {
  const canRead = useCan('work_orders:read');
  const history = useWorkOrderHistory(by, canRead);
  const porCliente = 'customerId' in by;

  if (!canRead) return null;

  return (
    <Card>
      <CardHeader
        title={title}
        description={history.data?.length ? `${history.data.length} ${history.data.length === 1 ? 'atendimento' : 'atendimentos'}` : undefined}
      />
      {history.isPending ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : history.isError ? (
        <div className="p-5">
          <Alert variant="danger">{errorMessage(history.error)}</Alert>
        </div>
      ) : !history.data.length ? (
        <EmptyState icon={History} title="Nenhum serviço registrado" description={emptyDescription} />
      ) : (
        <ul className="divide-y divide-border">
          {history.data.map((os) => {
            const servicos = os.items.filter((i) => i.type === 'SERVICE');
            const pecas = os.items.filter((i) => i.type === 'PART');
            const quando = os.deliveredAt ?? os.openedAt;
            return (
              <li key={os.id}>
                <Link
                  to={`/ordens/${os.number}`}
                  className="grid gap-1.5 px-5 py-4 transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular">OS {os.number}</span>
                      <StatusBadge status={os.status} />
                      <span className="text-sm text-muted tabular">
                        {formatDate(quando)}
                        {os.odometerKm !== null && ` · ${formatKm(os.odometerKm)}`}
                      </span>
                    </div>
                    {porCliente && (
                      <p className="text-sm text-muted">
                        {os.vehicleName}
                        {os.vehiclePlate && ` · ${formatPlate(os.vehiclePlate)}`}
                      </p>
                    )}
                    {servicos.length > 0 && (
                      <p className="text-sm break-words">
                        <span className="text-muted">Serviços: </span>
                        {servicos.map(itemLabel).join(', ')}
                      </p>
                    )}
                    {pecas.length > 0 && (
                      <p className="text-sm break-words">
                        <span className="text-muted">Peças: </span>
                        {pecas.map(itemLabel).join(', ')}
                      </p>
                    )}
                    {os.items.length === 0 && os.complaint && (
                      <p className="text-sm break-words text-muted">Relato: {os.complaint}</p>
                    )}
                    {os.mechanicName && <p className="text-xs text-muted">Mecânico: {os.mechanicName}</p>}
                  </div>
                  <span className="font-medium tabular sm:text-right">{formatBRL(os.totalCents)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
