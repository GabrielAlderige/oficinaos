import { formatBRL } from '@oficinaos/shared';
import { Package, PackageSearch, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Alert, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Select } from '../../components/ui/field';
import { EmptyState, Pagination, SearchInput } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { withParam } from '../../lib/search-params';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useInventorySummary, usePartCategories, useParts } from './api';
import { PartFormDialog } from './PartFormDialog';
import { formatQty, StockBadge } from './stock';

const GRID = 'md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_7rem]';

/** Números do estoque; os de alerta filtram a lista num clique. */
function InventoryTiles({ onAttention, attention }: { onAttention(): void; attention: boolean }) {
  const summary = useInventorySummary(true);
  if (!summary.data) return null;
  const s = summary.data;
  const problems = s.out + s.negative;
  const tiles: { label: string; value: string; tone?: string; alert?: boolean }[] = [
    { label: 'Com estoque controlado', value: String(s.trackedParts) },
    { label: 'Abaixo do mínimo', value: String(s.low), tone: s.low ? 'text-warning' : undefined, alert: s.low > 0 },
    { label: 'Sem estoque ou negativo', value: String(problems), tone: problems ? 'text-danger' : undefined, alert: problems > 0 },
    ...(s.stockValueCents !== null ? [{ label: 'Valor em estoque (custo)', value: formatBRL(s.stockValueCents) }] : []),
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => {
        const body = (
          <>
            <span className="block text-xs text-muted">{tile.label}</span>
            <span className={cn('mt-1 block text-xl font-semibold tracking-tight tabular', tile.tone)}>{tile.value}</span>
          </>
        );
        return tile.alert ? (
          <button
            key={tile.label}
            type="button"
            onClick={onAttention}
            aria-pressed={attention}
            className={cn('rounded-xl border border-border bg-surface p-4 text-left shadow-xs hover:bg-surface-muted/60', attention && 'ring-2 ring-accent-bright/40')}
          >
            {body}
          </button>
        ) : (
          <div key={tile.label} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function PartsPage() {
  const canWrite = useCan('catalog:write');
  const canSeeStock = useCan('inventory:read');
  // pesquisar peça é ver CUSTO: a mesma permissão do histórico de preço (E14)
  const canSeeCost = useCan('parts:view_cost');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const categoryId = params.get('categoria') || undefined;
  const attention = params.get('estoque') === 'atencao';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(search.trim(), 300);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (q === (params.get('q') ?? '')) return;
    setParams(withParam(params, 'q', q), { replace: true });
  }, [q, params, setParams]);

  const categories = usePartCategories();
  const parts = useParts({ q, categoryId, attention, page });
  const data = parts.data;
  const filtered = Boolean(q || categoryId || attention);

  return (
    <>
      <PageHeader
        title="Peças e estoque"
        description="Busque por nome, código, marca ou pelo carro: “pastilha gol 2012”."
        actions={
          <span className="flex flex-wrap gap-2">
            {canSeeCost && (
              <Button asChild variant="secondary">
                <Link to="/pecas/pesquisa">
                  <PackageSearch />
                  Pesquisar peças
                </Link>
              </Button>
            )}
            {canWrite && (
              <Button onClick={() => setCreating(true)}>
                <Plus />
                Nova peça
              </Button>
            )}
          </span>
        }
      />

      {canSeeStock && (
        <InventoryTiles attention={attention} onAttention={() => setParams(withParam(params, 'estoque', attention ? null : 'atencao'))} />
      )}

      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Nome, código, marca ou carro" label="Buscar peças" className="flex-1" autoFocus />
          <div className="sm:w-44">
            <Select aria-label="Categoria" value={categoryId ?? ''} onChange={(e) => setParams(withParam(params, 'categoria', e.target.value))}>
              <option value="">Todas as categorias</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          {canSeeStock && (
            <div className="sm:w-48">
              <Select aria-label="Situação do estoque" value={attention ? 'atencao' : ''} onChange={(e) => setParams(withParam(params, 'estoque', e.target.value))}>
                <option value="">Todo o estoque</option>
                <option value="atencao">Precisam de atenção</option>
              </Select>
            </div>
          )}
        </div>

        {parts.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : parts.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(parts.error)}</Alert>
          </div>
        ) : !data?.data.length ? (
          attention && !q && !categoryId ? (
            <EmptyState icon={Package} title="Nenhuma peça precisa de atenção" description="Nada abaixo do mínimo, sem estoque ou negativo." />
          ) : filtered ? (
            <EmptyState
              icon={Package}
              title={q ? `Nenhuma peça encontrada para “${q}”` : 'Nenhuma peça com esses filtros'}
              description="Tente pelo código do fabricante, ou só pelo nome e pelo carro: “pastilha gol”."
            />
          ) : (
            <EmptyState
              icon={Package}
              title="Nenhuma peça cadastrada"
              description="Cadastre as peças que a oficina tem na prateleira, com a quantidade de hoje. Daí em diante, entradas e ajustes ficam registrados."
              action={canWrite && <Button onClick={() => setCreating(true)}>Cadastrar a primeira peça</Button>}
            />
          )
        ) : (
          <>
            <div className={cn('hidden gap-4 border-b border-border px-5 py-2 text-xs font-medium text-muted md:grid', GRID)}>
              <span>Peça</span>
              <span>Categoria</span>
              <span>Disponível</span>
              <span className="text-right">Preço</span>
            </div>
            <ul className={parts.isPlaceholderData ? 'divide-y divide-border opacity-60' : 'divide-y divide-border'}>
              {data.data.map((part) => (
                <li key={part.id}>
                  <Link to={`/pecas/${part.id}`} className={cn('grid gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-muted/60 md:items-center', GRID)}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{part.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {[part.manufacturer, part.manufacturerCode, part.sku && `Cód. ${part.sku}`, part.location].filter(Boolean).join(' · ') || ' '}
                      </span>
                    </span>
                    <span className="truncate text-sm text-muted">{part.categoryName ?? '–'}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      {part.stockStatus !== 'NOT_TRACKED' && <span className="text-sm tabular">{formatQty(part.quantityAvailable, part.unit)}</span>}
                      {part.stockStatus !== 'OK' && <StockBadge status={part.stockStatus} />}
                    </span>
                    <span className="text-sm font-medium tabular md:text-right">
                      {part.salePriceCents !== null ? formatBRL(part.salePriceCents) : <span className="font-normal text-muted">Sem preço</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination meta={data.meta} onPageChange={(next) => setParams(withParam(params, 'page', String(next)))} />
          </>
        )}
      </Card>

      <PartFormDialog open={creating} onOpenChange={setCreating} onSaved={(p) => navigate(`/pecas/${p.id}`)} />
    </>
  );
}
