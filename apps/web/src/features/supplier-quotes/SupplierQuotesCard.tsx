import { SUPPLIER_QUOTE_STATUS_LABELS, type SupplierQuoteStatus, type WorkOrder } from '@oficinaos/shared';
import { ChevronRight, PackageSearch } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { formatRelative } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useWorkOrderSupplierQuotes } from './api';
import { NewSupplierQuoteDialog } from './NewSupplierQuoteDialog';

/** Vencida é aberta com o prazo passado: calculada pela API, mostrada como estado próprio. */
export function SupplierQuoteStatusBadge({ status, expired }: { status: SupplierQuoteStatus; expired: boolean }) {
  if (status === 'OPEN' && expired) return <Badge tone="warning">Prazo encerrado</Badge>;
  const tone = status === 'OPEN' ? 'info' : status === 'CLOSED' ? 'success' : 'danger';
  return <Badge tone={tone}>{SUPPLIER_QUOTE_STATUS_LABELS[status]}</Badge>;
}

/**
 * As cotações de peças desta OS. Só aparece para quem vê fornecedor, e só
 * quando há o que mostrar ou o que fazer: OS sem peça não tem o que cotar.
 */
export function SupplierQuotesCard({ order }: { order: WorkOrder }) {
  const podeVer = useCan('suppliers:read');
  const podeEnviar = useCan('supplier_quotes:send');
  const [abrindo, setAbrindo] = useState(false);
  const cotacoes = useWorkOrderSupplierQuotes(order.id, podeVer);

  const editavel = order.status !== 'DELIVERED' && order.status !== 'CANCELED';
  const temPeca = order.items.some((item) => item.type === 'PART');
  const podeCotar = podeEnviar && editavel && temPeca;
  const lista = cotacoes.data ?? [];

  if (!podeVer || (!podeCotar && lista.length === 0 && !cotacoes.isPending)) return null;

  return (
    <Card>
      <CardHeader
        title="Cotação de peças"
        description="Peça preço a vários fornecedores de uma vez; cada um responde pelo próprio link."
        action={
          podeCotar && (
            <Button size="sm" variant="secondary" onClick={() => setAbrindo(true)}>
              <PackageSearch />
              Cotar peças
            </Button>
          )
        }
      />
      {cotacoes.isPending ? (
        <div className="p-5">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : lista.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-muted">
          Nenhuma cotação ainda. Marque as peças, escolha os fornecedores e mande os links pelo WhatsApp.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {lista.map((cotacao) => {
            const aberta = cotacao.status === 'OPEN' && !cotacao.expired;
            return (
              <li key={cotacao.id}>
                <Link
                  to={`/ordens/${order.number}/cotacoes/${cotacao.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">Cotação nº {cotacao.number}</span>
                      <SupplierQuoteStatusBadge status={cotacao.status} expired={cotacao.expired} />
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {[
                        `${cotacao.answeredCount} de ${cotacao.supplierCount} ${cotacao.supplierCount === 1 ? 'respondeu' : 'responderam'}`,
                        `${cotacao.itemCount} ${cotacao.itemCount === 1 ? 'peça' : 'peças'}`,
                        aberta && `prazo ${formatRelative(cotacao.expiresAt)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {podeCotar && <NewSupplierQuoteDialog order={order} open={abrindo} onOpenChange={setAbrindo} />}
    </Card>
  );
}
