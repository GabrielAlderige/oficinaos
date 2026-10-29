import { formatBRL, type CounterSale } from '@oficinaos/shared';
import { Plus, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { EmptyState, Pagination } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { withParam } from '../../lib/search-params';
import { useCan } from '../../lib/session';
import { useCancelCounterSale, useCounterSales } from './api';
import { ProductInvoicePanel } from '../invoices/ProductInvoicePanel';
import { PosChargeFlow } from '../pos/PosCharge';
import { NovaVendaDialog } from './NovaVendaDialog';

function Situacao({ venda }: { venda: CounterSale }) {
  if (venda.status === 'CANCELED') return <Badge tone="danger">Cancelada</Badge>;
  if (venda.totalCents === 0 || venda.paidCents >= venda.totalCents) return <Badge tone="success">Paga</Badge>;
  return <Badge tone="warning">A receber</Badge>;
}

const resumoDosItens = (venda: CounterSale) => {
  const [primeiro, ...resto] = venda.items;
  if (!primeiro) return '';
  return resto.length ? `${primeiro.description} e mais ${resto.length}` : primeiro.description;
};

/**
 * Venda de balcão (E49): a peça vendida sem ordem de serviço. A lista mostra
 * as últimas vendas; a venda abre com os itens e, para quem pode, o cancelar.
 */
export function CounterSalesPage() {
  const podeVender = useCan('counter_sales:sell');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const vendas = useCounterSales(page);
  const [nova, setNova] = useState(false);
  const [aberta, setAberta] = useState<CounterSale | null>(null);

  return (
    <>
      <PageHeader
        title="Venda de balcão"
        description="Peça vendida sem ordem de serviço: sai do estoque e entra no financeiro na hora."
        actions={
          podeVender && (
            <Button onClick={() => setNova(true)}>
              <Plus />
              Nova venda
            </Button>
          )
        }
      />

      <Card>
        {vendas.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : vendas.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(vendas.error)}</Alert>
          </div>
        ) : !vendas.data.data.length ? (
          <EmptyState
            icon={ShoppingBag}
            title="Nenhuma venda de balcão ainda"
            description="O cliente passou e levou um óleo, uma lâmpada? Registre aqui: a peça sai do estoque e o dinheiro entra no caixa."
            action={podeVender && <Button onClick={() => setNova(true)}>Fazer a primeira venda</Button>}
          />
        ) : (
          <>
            <ul className={vendas.isPlaceholderData ? 'divide-y divide-border opacity-60' : 'divide-y divide-border'}>
              {vendas.data.data.map((venda) => (
                <li key={venda.id}>
                  <button
                    type="button"
                    onClick={() => setAberta(venda)}
                    className="grid w-full gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-surface-muted/60 md:grid-cols-[6rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_6rem] md:items-center"
                  >
                    <span className="text-sm font-semibold tabular">Venda {venda.number}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{resumoDosItens(venda)}</span>
                      <span className="block truncate text-xs text-muted">{formatDateTime(venda.soldAt)}</span>
                    </span>
                    <span className="truncate text-sm text-muted">{venda.customerName ?? 'Sem cadastro'}</span>
                    <span>
                      <Situacao venda={venda} />
                    </span>
                    <span className="text-sm font-medium tabular md:text-right">{formatBRL(venda.totalCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination meta={vendas.data.meta} onPageChange={(next) => setParams(withParam(params, 'page', String(next)))} />
          </>
        )}
      </Card>

      <NovaVendaDialog open={nova} onOpenChange={setNova} />
      <DetalheDaVenda venda={aberta} onClose={() => setAberta(null)} />
    </>
  );
}

function DetalheDaVenda({ venda, onClose }: { venda: CounterSale | null; onClose(): void }) {
  const podeCancelar = useCan('counter_sales:cancel');
  const cancelar = useCancelCounterSale();
  const [cancelando, setCancelando] = useState(false);
  const podeCobrar = useCan('payments:record');
  const [cobrando, setCobrando] = useState(false);
  const [motivo, setMotivo] = useState('');

  function fechar() {
    setCancelando(false);
    setCobrando(false);
    setMotivo('');
    onClose();
  }

  async function confirmar() {
    if (!venda) return;
    try {
      await cancelar.mutateAsync({ id: venda.id, reason: motivo });
      toast.success(`Venda ${venda.number} cancelada. As peças voltaram ao estoque.`);
      fechar();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={venda !== null} onOpenChange={(open) => !open && fechar()}>
      <DialogContent>
        {venda && cobrando ? (
          <PosChargeFlow
            origem={{ counterSaleId: venda.id }}
            valorCents={venda.totalCents - venda.paidCents}
            onClose={fechar}
          />
        ) : venda && (
          <>
            <DialogHeader
              title={`Venda ${venda.number}`}
              description={`${formatDateTime(venda.soldAt)}${venda.soldByName ? ` · ${venda.soldByName}` : ''}${venda.customerName ? ` · ${venda.customerName}` : ''}`}
            />
            <div className="space-y-3">
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {venda.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate">{item.description}</span>
                      <span className="text-xs text-muted">
                        {String(item.quantity).replace('.', ',')} × {formatBRL(item.unitPriceCents)}
                      </span>
                    </span>
                    <span className="tabular">{formatBRL(item.totalCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1 text-sm">
                {venda.discountCents > 0 && (
                  <p className="flex justify-between text-muted">
                    <span>Desconto</span>
                    <span className="tabular">−{formatBRL(venda.discountCents)}</span>
                  </p>
                )}
                <p className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="tabular">{formatBRL(venda.totalCents)}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-muted">Situação</span>
                  <Situacao venda={venda} />
                </p>
              </div>
              {venda.notes && <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">{venda.notes}</p>}
              {venda.status === 'COMPLETED' && venda.paidCents < venda.totalCents && podeCobrar && (
                <Button size="sm" variant="secondary" onClick={() => setCobrando(true)}>
                  Cobrar na maquininha · {formatBRL(venda.totalCents - venda.paidCents)}
                </Button>
              )}
              {venda.status === 'COMPLETED' && <ProductInvoicePanel origem={{ counterSaleId: venda.id }} />}
              {venda.status === 'CANCELED' && (
                <Alert variant="warning">
                  Cancelada em {formatDateTime(venda.canceledAt!)}: {venda.cancelReason}
                </Alert>
              )}
              {cancelando && (
                <Field label="Motivo do cancelamento" htmlFor="balcao-motivo" hint="As peças voltam ao estoque e o dinheiro sai do caixa.">
                  <Input
                    {...fieldA11y('balcao-motivo', undefined, true)}
                    value={motivo}
                    onChange={(event) => setMotivo(event.target.value)}
                    maxLength={300}
                    autoFocus
                  />
                </Field>
              )}
            </div>
            <DialogFooter>
              {podeCancelar && venda.status === 'COMPLETED' && !cancelando && (
                <Button variant="secondary" onClick={() => setCancelando(true)}>
                  Cancelar venda
                </Button>
              )}
              {cancelando ? (
                <>
                  <Button variant="secondary" onClick={() => setCancelando(false)} disabled={cancelar.isPending}>
                    Voltar
                  </Button>
                  <Button
                    variant="danger"
                    loading={cancelar.isPending}
                    disabled={motivo.trim().length < 3}
                    onClick={() => void confirmar()}
                  >
                    Confirmar cancelamento
                  </Button>
                </>
              ) : (
                <Button onClick={fechar}>Fechar</Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
