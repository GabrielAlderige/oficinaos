import { formatBRL, type ServicePackage } from '@oficinaos/shared';
import { Boxes, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useServicePackages } from './api';
import { PackageFormDialog } from './PackageFormDialog';
import { ServicesTabs } from './ServicesTabs';

/** "1 serviço · 3 peças": o que o pacote leva, sem abrir. */
function resumo(pacote: ServicePackage): string {
  const servicos = pacote.items.filter((item) => item.kind === 'SERVICE').length;
  const pecas = pacote.items.filter((item) => item.kind === 'PART').length;
  return [
    servicos && `${servicos} ${servicos === 1 ? 'serviço' : 'serviços'}`,
    pecas && `${pecas} ${pecas === 1 ? 'peça' : 'peças'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Pacotes de serviço (E27).
 *
 * "Revisão dos 10.000 km" são seis linhas que a oficina digita toda semana. O
 * pacote guarda a lista; o preço mostrado é o do catálogo **hoje**, porque é
 * isso que vai cair na OS — e na OS cada linha continua editável.
 */
export function PackagesPage() {
  const podeEscrever = useCan('catalog:write');
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<ServicePackage | null>(null);
  const pacotes = useServicePackages(true);

  return (
    <>
      <PageHeader
        title="Pacotes"
        description="Combinações que a oficina vende juntas. Na OS, entram com um clique."
        actions={
          podeEscrever && (
            <Button onClick={() => setCriando(true)}>
              <Plus />
              Novo pacote
            </Button>
          )
        }
      />
      <ServicesTabs />

      {pacotes.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : pacotes.isError ? (
        <Alert variant="danger">{errorMessage(pacotes.error)}</Alert>
      ) : !pacotes.data.length ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title="Nenhum pacote cadastrado"
            description="Comece pelo que a oficina mais repete: a revisão do óleo com filtro, o kit de freio dianteiro. Cada pacote vira um clique na hora de montar a OS."
            action={podeEscrever && <Button onClick={() => setCriando(true)}>Criar o primeiro pacote</Button>}
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {pacotes.data.map((pacote) => {
            const foraDoCatalogo = pacote.items.filter((item) => item.unavailable).length;
            const conteudo = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{pacote.name}</span>
                      {!pacote.isActive && <Badge>Inativo</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{resumo(pacote)}</p>
                  </div>
                  <p className="shrink-0 text-lg font-semibold tabular">{formatBRL(pacote.totalCents)}</p>
                </div>
                {pacote.description && <p className="mt-2 line-clamp-2 text-sm text-muted">{pacote.description}</p>}
                <ul className="mt-3 space-y-1">
                  {pacote.items.slice(0, 4).map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-muted">
                        {item.quantity > 1 && <span className="tabular">{item.quantity}× </span>}
                        {item.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted tabular">
                        {item.unavailable
                          ? 'fora do catálogo'
                          : item.unitPriceCents !== null
                            ? formatBRL(Math.round(item.unitPriceCents * item.quantity))
                            : 'sem preço'}
                      </span>
                    </li>
                  ))}
                  {pacote.items.length > 4 && (
                    <li className="text-xs text-muted">e mais {pacote.items.length - 4}…</li>
                  )}
                </ul>
                {foraDoCatalogo > 0 && (
                  <p className="mt-3 text-xs text-warning">
                    {foraDoCatalogo === 1 ? '1 item saiu do catálogo' : `${foraDoCatalogo} itens saíram do catálogo`} e
                    não entram na soma.
                  </p>
                )}
              </>
            );
            return (
              <li key={pacote.id}>
                <Card className="h-full">
                  {podeEscrever ? (
                    <button
                      type="button"
                      onClick={() => setEditando(pacote)}
                      className="block h-full w-full rounded-xl p-5 text-left hover:bg-surface-muted/60"
                    >
                      {conteudo}
                    </button>
                  ) : (
                    <div className="p-5">{conteudo}</div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <PackageFormDialog open={criando} onOpenChange={setCriando} />
      {editando && (
        <PackageFormDialog
          open
          onOpenChange={(aberto) => !aberto && setEditando(null)}
          pacote={editando}
        />
      )}
    </>
  );
}
