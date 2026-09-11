import { Car, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PlateBadge } from '../../components/plate-badge';
import { Button } from '../../components/ui/button';
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState, Pagination, SearchInput } from '../../components/ui/list-parts';
import { formatKm } from '../../lib/contact';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useVehicles } from './api';
import { VehicleFormDialog } from './VehicleFormDialog';

export function VehiclesPage() {
  const canWrite = useCan('vehicles:write');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(search.trim(), 300);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    setParams(q ? { q } : {}, { replace: true });
  }, [q, params, setParams]);

  const vehicles = useVehicles({ q, page });
  const data = vehicles.data;

  return (
    <>
      <PageHeader
        title="Veículos"
        description="Digite a placa (antiga ou Mercosul), o modelo ou o nome do dono."
        actions={
          canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Novo veículo
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b border-border p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Placa, modelo ou dono" label="Buscar veículos" autoFocus />
        </div>
        {vehicles.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : vehicles.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(vehicles.error)}</Alert>
          </div>
        ) : !data?.data.length ? (
          q ? (
            <EmptyState icon={Car} title={`Nenhum veículo encontrado para “${q}”`} description="A placa pode ter sido cadastrada no formato antigo ou Mercosul: os dois são encontrados." />
          ) : (
            <EmptyState
              icon={Car}
              title="Nenhum veículo ainda"
              description="Cadastre pela página do cliente ou aqui mesmo."
              action={canWrite && <Button onClick={() => setCreating(true)}>Cadastrar o primeiro veículo</Button>}
            />
          )
        ) : (
          <>
            <ul className={vehicles.isPlaceholderData ? 'divide-y divide-border opacity-60' : 'divide-y divide-border'}>
              {data.data.map((v) => (
                <li key={v.id}>
                  <Link to={`/veiculos/${v.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 hover:bg-surface-muted/60">
                    <PlateBadge plate={v.plate} />
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate text-sm font-medium">
                        {v.make} {v.model} {v.version}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {v.customer.name}
                        {v.yearManufacture && ` · ${v.yearManufacture}/${v.yearModel ?? v.yearManufacture}`}
                      </span>
                    </span>
                    <span className="text-sm text-muted tabular">{v.odometerKm !== null ? formatKm(v.odometerKm) : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination meta={data.meta} onPageChange={(next) => setParams({ ...(q ? { q } : {}), page: String(next) })} />
          </>
        )}
      </Card>
      <VehicleFormDialog open={creating} onOpenChange={setCreating} onSaved={(v) => navigate(`/veiculos/${v.id}`)} />
    </>
  );
}
