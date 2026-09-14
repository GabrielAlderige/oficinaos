import { formatBRL, formatPercentInput, MOVEMENT_TYPE_LABELS, PART_UNIT_LABELS, PART_UNIT_SHORT, type Part, type PartApplication } from '@oficinaos/shared';
import { ArrowDownToLine, CarFront, ClipboardCheck, History, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { usePageCrumb } from '../../app/layouts/crumbs';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { ConfirmDialog } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useOrganizationSettings } from '../settings/api';
import { useDeletePart, usePart, usePartApplications, usePartMovements, useRemoveApplication } from './api';
import { ApplicationDialog } from './ApplicationDialog';
import { PartFormDialog } from './PartFormDialog';
import { StockMovementDialog, type MovementMode } from './StockMovementDialog';
import { formatQty, StockBadge } from './stock';

export function PartPage() {
  const { id = '' } = useParams();
  const part = usePart(id);
  usePageCrumb(part.data?.name);

  if (part.isPending) {
    return (
      <div className="space-y-4" aria-label="Carregando peça">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (part.isError) {
    return (
      <Alert variant="danger">
        {errorMessage(part.error)}{' '}
        <Link to="/pecas" className="font-medium underline">
          Voltar para as peças
        </Link>
      </Alert>
    );
  }
  return <PartDetail part={part.data} />;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">–</span>}</dd>
    </div>
  );
}

function Stat({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('mt-0.5 text-lg tracking-tight tabular', strong ? 'font-semibold' : 'font-medium')}>
        {value}
        {note && <span className="block text-[11px] font-normal tracking-normal text-muted">{note}</span>}
      </dd>
    </div>
  );
}

function PartDetail({ part }: { part: Part }) {
  const navigate = useNavigate();
  const canWrite = useCan('catalog:write');
  const canAdjust = useCan('inventory:adjust');
  // o atendente vê a peça mas pode não ver fornecedor: aí o nome aparece sem link
  const podeVerFornecedor = useCan('suppliers:read');
  const canSeeMovements = useCan('inventory:read');
  const settings = useOrganizationSettings();
  const remove = useDeletePart();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [movement, setMovement] = useState<MovementMode | null>(null);

  const subtitle = [part.manufacturer, part.manufacturerCode, part.sku && `Cód. interno ${part.sku}`].filter(Boolean).join(' · ');
  const cost = part.averageCostCents ?? part.lastCostCents;
  const belowCost = !part.costHidden && part.salePriceCents !== null && cost !== null && part.salePriceCents < cost;
  const defaultMarkup = settings.data?.defaultMarkupBps;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{part.name}</h1>
            <StockBadge status={part.stockStatus} />
            {!part.isActive && <Badge>Inativa</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">{[part.category?.name, subtitle].filter(Boolean).join(' · ') || 'Peça do catálogo'}</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil />
              Editar
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Excluir peça">
              <Trash2 />
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Estoque"
              description={part.location ? `Localização: ${part.location}` : undefined}
              action={
                part.trackStock &&
                canAdjust && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setMovement('ENTRY')}>
                      <ArrowDownToLine />
                      Entrada
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setMovement('ADJUSTMENT')}>
                      <ClipboardCheck />
                      Ajustar contagem
                    </Button>
                  </div>
                )
              }
            />
            {part.trackStock ? (
              <dl className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
                <Stat label="Em estoque" value={formatQty(part.quantityOnHand, part.unit)} strong />
                {/* reserva nasce na aprovação da OS: só aparece quando existe */}
                {part.quantityReserved > 0 && (
                  <>
                    <Stat label="Reservado" value={formatQty(part.quantityReserved, part.unit)} note="para OS aprovadas" />
                    <Stat label="Disponível" value={formatQty(part.quantityAvailable, part.unit)} strong />
                  </>
                )}
                <Stat label="Mínimo" value={formatQty(part.minQuantity, part.unit)} />
              </dl>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">
                Esta peça não controla estoque: entra no orçamento sem baixa na prateleira. Para controlar, edite a peça.
              </p>
            )}
            {part.stockStatus === 'NEGATIVE' && (
              <div className="px-5 pb-4">
                <Alert variant="danger">O estoque ficou negativo. Conte a prateleira e registre um ajuste.</Alert>
              </div>
            )}
          </Card>

          {canSeeMovements && <MovementsCard part={part} />}
          <ApplicationsCard partId={part.id} canWrite={canWrite} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Preço" />
            <dl className="px-5 py-3">
              <Info label="Preço de venda">{part.salePriceCents !== null && <span className="font-medium">{formatBRL(part.salePriceCents)}</span>}</Info>
              {!part.costHidden && (
                <>
                  <Info label="Custo médio">{part.averageCostCents !== null && formatBRL(part.averageCostCents)}</Info>
                  <Info label="Último custo">{part.lastCostCents !== null && formatBRL(part.lastCostCents)}</Info>
                  <Info label="Margem">
                    {part.markupBps !== null
                      ? `${formatPercentInput(part.markupBps)}%`
                      : defaultMarkup !== undefined && `${formatPercentInput(defaultMarkup)}% (padrão)`}
                  </Info>
                  <Info label="Sugerido">{part.suggestedPriceCents !== null && formatBRL(part.suggestedPriceCents)}</Info>
                </>
              )}
            </dl>
            {belowCost && (
              <div className="px-5 pb-4">
                <Alert variant="warning">O preço de venda está abaixo do custo.</Alert>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Detalhes" />
            <dl className="px-5 py-3">
              <Info label="Unidade">{PART_UNIT_LABELS[part.unit]}</Info>
              <Info label="Categoria">{part.category?.name}</Info>
              <Info label="Fornecedor preferido">
                {part.preferredSupplier &&
                  (podeVerFornecedor ? (
                    <Link to={`/fornecedores/${part.preferredSupplier.id}`} className="hover:underline">
                      {part.preferredSupplier.name}
                    </Link>
                  ) : (
                    part.preferredSupplier.name
                  ))}
              </Info>
              <Info label="Código de barras">{part.ean}</Info>
              <Info label="Descrição">{part.description && <span className="whitespace-pre-line">{part.description}</span>}</Info>
            </dl>
          </Card>
        </div>
      </div>

      <PartFormDialog open={editing} onOpenChange={setEditing} part={part} />
      <StockMovementDialog part={part} mode={movement} onClose={() => setMovement(null)} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title={`Excluir ${part.name}?`}
        description="A peça sai do catálogo e das buscas. Os movimentos de estoque continuam guardados. Para só esconder dos novos orçamentos, edite e desmarque “Peça ativa”."
        confirmLabel="Excluir"
        onConfirm={async () => {
          try {
            await remove.mutateAsync(part.id);
            toast.success(`${part.name} foi excluída.`);
            navigate('/pecas', { replace: true });
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}

function MovementsCard({ part }: { part: Part }) {
  const movements = usePartMovements(part.id);
  const unit = PART_UNIT_SHORT[part.unit];
  return (
    <Card>
      <CardHeader title="Movimentos de estoque" description="Toda entrada e todo ajuste ficam registrados, com quem fez e quando." />
      {movements.isPending ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : movements.isError ? (
        <div className="p-5">
          <Alert variant="danger">{errorMessage(movements.error)}</Alert>
        </div>
      ) : !movements.data.length ? (
        <EmptyState icon={History} title="Nenhum movimento ainda" description="Entradas e ajustes de contagem aparecem aqui." />
      ) : (
        <ul className="divide-y divide-border">
          {movements.data.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{MOVEMENT_TYPE_LABELS[m.type]}</p>
                <p className="text-xs text-muted">
                  {[formatDateTime(m.createdAt), m.createdByName, m.reason].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={cn('text-sm font-medium tabular', m.quantity > 0 ? 'text-success' : 'text-danger')}>
                  {m.quantity > 0 ? '+' : '−'}
                  {formatQty(Math.abs(m.quantity), part.unit)}
                </p>
                <p className="text-xs text-muted tabular">
                  Saldo {formatQty(m.balanceAfter, part.unit)}
                  {m.unitCostCents !== null && ` · ${formatBRL(m.unitCostCents)}/${unit}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function yearsText(a: PartApplication): string | null {
  if (a.yearFrom && a.yearTo) return a.yearFrom === a.yearTo ? String(a.yearFrom) : `${a.yearFrom}–${a.yearTo}`;
  if (a.yearFrom) return `${a.yearFrom} em diante`;
  if (a.yearTo) return `até ${a.yearTo}`;
  return null;
}

const carName = (a: PartApplication) => [a.make, a.model, a.engine].filter(Boolean).join(' ');

function ApplicationsCard({ partId, canWrite }: { partId: string; canWrite: boolean }) {
  const applications = usePartApplications(partId);
  const removeApplication = useRemoveApplication(partId);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PartApplication | null>(null);

  return (
    <Card>
      <CardHeader
        title="Aplicação"
        description="Em que carros a peça serve. A busca usa esta lista: “pastilha gol 2012”."
        action={
          canWrite && (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Adicionar carro
            </Button>
          )
        }
      />
      {applications.isPending ? (
        <div className="p-5">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : applications.isError ? (
        <div className="p-5">
          <Alert variant="danger">{errorMessage(applications.error)}</Alert>
        </div>
      ) : !applications.data.length ? (
        <EmptyState
          icon={CarFront}
          title="Nenhum carro informado"
          description="Informe em que carros a peça serve para ela aparecer quando alguém buscar pelo modelo."
          action={canWrite && <Button onClick={() => setAdding(true)}>Adicionar carro</Button>}
        />
      ) : (
        <ul className="divide-y divide-border">
          {applications.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
              <CarFront className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{carName(a)}</p>
                <p className="truncate text-xs text-muted">{[yearsText(a) ?? 'Todos os anos', a.notes].filter(Boolean).join(' · ')}</p>
              </div>
              {canWrite && (
                <Button variant="ghost" size="icon" className="size-8" aria-label={`Remover ${carName(a)}`} onClick={() => setRemoving(a)}>
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ApplicationDialog partId={partId} open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        destructive
        title={removing ? `Remover ${carName(removing)}?` : 'Remover carro?'}
        description="A peça deixa de aparecer na busca por este carro."
        confirmLabel="Remover"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeApplication.mutateAsync(removing.id);
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </Card>
  );
}
