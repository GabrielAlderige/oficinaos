import { formatQuantity, type WorkOrder } from '@oficinaos/shared';
import { ChevronRight, ShoppingCart } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, Skeleton } from '../../components/ui/display';
import { useCan } from '../../lib/session';
import { useWorkOrderPurchases } from './api';
import { dataCurta, PurchaseStatusBadge } from './status';

const qtd = (valor: number) => formatQuantity(Math.round(valor * 1000));

/**
 * O que foi comprado para esta OS e em que pé está. Só para quem vê compras
 * (é custo). Aparece quando há compra, ou quando há peça marcada "Comprar"
 * esperando pedido.
 */
export function WorkOrderPurchasesCard({ order }: { order: WorkOrder }) {
  const podeVer = useCan('purchases:read');
  const podeComprar = useCan('purchases:write');
  const compras = useWorkOrderPurchases(order.id, podeVer);

  if (!podeVer) return null;
  const linhas = compras.data ?? [];
  const pedidas = new Set(linhas.filter((l) => l.status !== 'CANCELED').map((l) => l.workOrderItemId));
  const esperando = order.items.filter(
    (item) => item.type === 'PART' && item.partId && item.sourcing === 'TO_ORDER' && item.stockStatus !== 'CONSUMED' && !pedidas.has(item.id),
  );
  const editavel = order.status !== 'DELIVERED' && order.status !== 'CANCELED';
  const podePedir = podeComprar && editavel && esperando.length > 0;
  if (!compras.isPending && !linhas.length && !podePedir) return null;

  return (
    <Card>
      <CardHeader
        title="Compras"
        description={
          esperando.length > 0 && editavel
            ? `${esperando.length} ${esperando.length === 1 ? 'peça marcada' : 'peças marcadas'} "Comprar" sem pedido.`
            : 'As peças compradas para esta OS.'
        }
        action={
          podePedir && (
            <Button asChild size="sm" variant="secondary">
              <Link to={`/compras/novo?os=${order.number}`}>
                <ShoppingCart />
                Pedir peças
              </Link>
            </Button>
          )
        }
      />
      {compras.isPending ? (
        <div className="p-5">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !linhas.length ? (
        <p className="px-5 py-5 text-sm text-muted">Nenhuma compra ainda para esta OS.</p>
      ) : (
        <ul className="divide-y divide-border">
          {linhas.map((linha) => (
            <li key={`${linha.purchaseOrderId}-${linha.workOrderItemId}`}>
              <Link to={`/compras/${linha.purchaseOrderId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{linha.description}</span>
                    <PurchaseStatusBadge status={linha.status} />
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {[
                      `pedido nº ${linha.purchaseOrderNumber}`,
                      linha.supplierName,
                      `chegou ${qtd(linha.receivedQuantity)} de ${qtd(linha.quantity)}`,
                      linha.expectedOn && linha.status !== 'RECEIVED' && linha.status !== 'CANCELED' && `previsão ${dataCurta(linha.expectedOn)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
