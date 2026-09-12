import { formatBRL, formatDuration, type Service } from '@oficinaos/shared';
import { Plus, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Select } from '../../components/ui/field';
import { EmptyState, Pagination, SearchInput } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { withParam } from '../../lib/search-params';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useServices, type ServiceListParams } from './api';
import { ServiceFormDialog } from './ServiceFormDialog';

const STATUS_LABELS: Record<ServiceListParams['status'], string> = { active: 'Ativos', inactive: 'Inativos', all: 'Todos' };

/** "A cada 10.000 km ou 12 meses": a base do lembrete de próxima revisão. */
function intervalText(service: Pick<Service, 'intervalKm' | 'intervalMonths'>): string | null {
  const parts = [
    service.intervalKm && `${service.intervalKm.toLocaleString('pt-BR')} km`,
    service.intervalMonths && `${service.intervalMonths} ${service.intervalMonths === 1 ? 'mês' : 'meses'}`,
  ].filter(Boolean);
  return parts.length ? `A cada ${parts.join(' ou ')}` : null;
}

function pricingText(service: Service): string {
  if (service.pricingMode === 'HOURLY') return `${formatDuration(service.estimatedMinutes ?? 0)} × hora técnica`;
  return service.estimatedMinutes ? `Preço fixo · ${formatDuration(service.estimatedMinutes)}` : 'Preço fixo';
}

const GRID = 'md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_8rem]';

export function ServicesPage() {
  const canWrite = useCan('catalog:write');
  const canManageOrg = useCan('organization:manage');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const statusParam = params.get('status');
  const status: ServiceListParams['status'] = statusParam === 'inactive' || statusParam === 'all' ? statusParam : 'active';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(search.trim(), 300);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);

  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    setParams(withParam(params, 'q', q), { replace: true });
  }, [q, params, setParams]);

  const services = useServices({ q, status, page });
  const data = services.data;
  const missingRate = data?.data.some((s) => s.effectivePriceCents === null);

  return (
    <>
      <PageHeader
        title="Serviços"
        description="A mão de obra que a oficina cobra. O orçamento puxa o preço e o tempo daqui."
        actions={
          canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Novo serviço
            </Button>
          )
        }
      />

      {missingRate && (
        <Alert variant="warning" className="mb-4">
          Serviços cobrados por hora estão sem preço: o valor da hora técnica ainda não foi definido.{' '}
          {canManageOrg ? (
            <Link to="/configuracoes/precos" className="font-medium underline">
              Definir hora técnica
            </Link>
          ) : (
            'Peça ao dono ou ao administrador para definir.'
          )}
        </Alert>
      )}

      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Nome ou categoria do serviço" label="Buscar serviços" className="flex-1" autoFocus />
          <div className="sm:w-36">
            <Select
              aria-label="Situação"
              value={status}
              onChange={(e) => setParams(withParam(params, 'status', e.target.value === 'active' ? null : e.target.value), { replace: true })}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {services.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : services.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(services.error)}</Alert>
          </div>
        ) : !data?.data.length ? (
          q || status !== 'active' ? (
            <EmptyState icon={Wrench} title={q ? `Nenhum serviço encontrado para “${q}”` : 'Nenhum serviço nesta situação'} />
          ) : (
            <EmptyState
              icon={Wrench}
              title="Nenhum serviço cadastrado"
              description="Comece pelos que a oficina mais faz: troca de óleo, alinhamento, revisão. Com preço e tempo cadastrados, o orçamento sai em poucos cliques."
              action={canWrite && <Button onClick={() => setCreating(true)}>Cadastrar o primeiro serviço</Button>}
            />
          )
        ) : (
          <>
            <div className={cn('hidden gap-4 border-b border-border px-5 py-2 text-xs font-medium text-muted md:grid', GRID)}>
              <span>Serviço</span>
              <span>Cobrança</span>
              <span className="text-right">Preço</span>
            </div>
            <ul className={services.isPlaceholderData ? 'divide-y divide-border opacity-60' : 'divide-y divide-border'}>
              {data.data.map((service) => {
                const content = (
                  <>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{service.name}</span>
                        {!service.isActive && <Badge>Inativo</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[service.category, intervalText(service)].filter(Boolean).join(' · ') || ' '}
                      </span>
                    </span>
                    <span className="text-sm text-muted">{pricingText(service)}</span>
                    <span className="text-sm font-medium tabular md:text-right">
                      {service.effectivePriceCents !== null ? (
                        formatBRL(service.effectivePriceCents)
                      ) : (
                        <span className="font-normal text-warning">Sem hora técnica</span>
                      )}
                    </span>
                  </>
                );
                const rowClass = cn('grid w-full gap-x-4 gap-y-1 px-5 py-3 text-left md:items-center', GRID);
                return (
                  <li key={service.id}>
                    {canWrite ? (
                      <button type="button" onClick={() => setEditing(service)} className={cn(rowClass, 'hover:bg-surface-muted/60')}>
                        {content}
                      </button>
                    ) : (
                      <div className={rowClass}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination meta={data.meta} onPageChange={(next) => setParams(withParam(params, 'page', String(next)))} />
          </>
        )}
      </Card>

      <ServiceFormDialog open={creating} onOpenChange={setCreating} />
      <ServiceFormDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} service={editing ?? undefined} />
    </>
  );
}
