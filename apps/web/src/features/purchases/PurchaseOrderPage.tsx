import {
  allocateFreight,
  canPurchaseAction,
  formatBRL,
  formatBRLInput,
  formatQuantity,
  landedUnitCostCents,
  lineValueCents,
  parseBRL,
  parseQuantity,
  type OrderedPurchaseOrder,
  type PurchaseOrder,
} from '@oficinaos/shared';
import { Ban, CheckCheck, Copy, MessageCircle, PackageCheck, Pencil, Send, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { usePageCrumb } from '../../app/layouts/crumbs';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import {
  useCancelPurchaseOrder,
  useClosePurchaseOrder,
  useOrderPurchaseOrder,
  usePurchaseOrder,
  useReceivePurchaseOrder,
  useReturnPurchaseOrder,
} from './api';
import { dataCurta, PurchaseStatusBadge } from './status';

type Linha = PurchaseOrder['items'][number];

const qtd = (valor: number, unidade?: string) => formatQuantity(Math.round(valor * 1000), unidade?.toLowerCase());

function motivo(err: unknown): string {
  if (err instanceof ApiError && err.problem?.errors?.length) return err.problem.errors.map((e) => e.message).join(' · ');
  return errorMessage(err);
}

export function PurchaseOrderPage() {
  const { id = '' } = useParams();
  const pedido = usePurchaseOrder(id);
  usePageCrumb(pedido.data ? `Pedido nº ${pedido.data.number}` : undefined);

  if (pedido.isPending) {
    return (
      <div className="space-y-4" aria-label="Carregando pedido">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (pedido.isError) {
    return (
      <Alert variant="danger">
        {errorMessage(pedido.error)}{' '}
        <Link to="/compras" className="font-medium underline">
          Voltar para as compras
        </Link>
      </Alert>
    );
  }
  return <Ficha pedido={pedido.data} />;
}

function Ficha({ pedido }: { pedido: PurchaseOrder }) {
  const podeComprar = useCan('purchases:write');
  const [dialogo, setDialogo] = useState<null | 'pedir' | 'receber' | 'devolver' | 'cancelar' | 'encerrar'>(null);
  const pode = (acao: Parameters<typeof canPurchaseAction>[1]) => podeComprar && canPurchaseAction(pedido.status, acao);
  const oss = [...new Map(pedido.items.flatMap((l) => (l.workOrder ? [[l.workOrder.id, l.workOrder] as const] : []))).values()];
  const falta = pedido.items.some((l) => l.pendingQuantity > 0);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Pedido de compra nº {pedido.number}
            <PurchaseStatusBadge status={pedido.status} />
          </span>
        }
        description={[
          pedido.supplier.name + (pedido.supplier.removed ? ' (fora da lista)' : ''),
          `criado em ${formatDate(pedido.createdAt)}${pedido.createdBy ? ` por ${pedido.createdBy.name}` : ''}`,
        ].join(' · ')}
        actions={
          <span className="flex flex-wrap gap-2">
            {pode('edit') && (
              <Button asChild variant="secondary">
                <Link to={`/compras/${pedido.id}/editar`}>
                  <Pencil />
                  Editar
                </Link>
              </Button>
            )}
            {pode('order') && (
              <Button onClick={() => setDialogo('pedir')}>
                <Send />
                Marcar como pedido
              </Button>
            )}
            {pode('receive') && (
              <Button onClick={() => setDialogo('receber')}>
                <PackageCheck />
                Receber
              </Button>
            )}
            {pode('return') && (
              <Button variant="secondary" onClick={() => setDialogo('devolver')}>
                <Undo2 />
                Devolver
              </Button>
            )}
            {pode('close') && (
              <Button variant="secondary" onClick={() => setDialogo('encerrar')}>
                <CheckCheck />
                Encerrar o que falta
              </Button>
            )}
            {pode('cancel') && (
              <Button variant="secondary" onClick={() => setDialogo('cancelar')}>
                <Ban />
                Cancelar
              </Button>
            )}
          </span>
        }
      />

      <div className="mb-6 space-y-3">
        {pedido.status === 'DRAFT' && (
          <Alert variant="info">Rascunho: ainda não foi ao fornecedor. Confira as peças e marque como pedido para mandar a mensagem.</Alert>
        )}
        {pedido.status === 'CANCELED' && (
          <Alert variant="danger">
            Cancelado{pedido.canceledAt ? ` em ${formatDateTime(pedido.canceledAt)}` : ''}: {pedido.cancelReason}
          </Alert>
        )}
        {pedido.closedShortAt && (
          <Alert variant="warning">
            Encerrado sem chegar tudo em {formatDateTime(pedido.closedShortAt)}: {pedido.closeReason}
          </Alert>
        )}
        {(pedido.status === 'ORDERED' || pedido.status === 'PARTIAL') && falta && (
          <p className="text-sm text-muted">
            Pedido feito{pedido.orderedAt ? ` em ${formatDateTime(pedido.orderedAt)}` : ''}
            {pedido.expectedOn ? ` · previsão de entrega ${dataCurta(pedido.expectedOn)}` : ''}.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Peças" />
            <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_6.5rem] gap-3 border-b border-border px-5 py-2 text-xs font-medium text-muted sm:grid">
              <span>Peça</span>
              <span className="text-right">Pedido</span>
              <span className="text-right">Chegou</span>
              <span className="text-right">Falta</span>
              <span className="text-right">Total</span>
            </div>
            <ul className="divide-y divide-border">
              {pedido.items.map((linha) => (
                <li key={linha.id} className="grid gap-x-3 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_6.5rem] sm:items-center">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{linha.description}</span>
                    <span className="block text-xs break-words text-muted">
                      {[
                        linha.partCode,
                        `${formatBRL(linha.unitCostCents)} cada`,
                        linha.returnedQuantity > 0 && `${qtd(linha.returnedQuantity, linha.unit)} devolvida(s)`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {linha.workOrder && (
                      <Link to={`/ordens/${linha.workOrder.number}`} className="block text-xs break-words text-accent hover:underline dark:text-accent-bright">
                        Para a OS {linha.workOrder.number} · {linha.workOrder.vehicleLabel}
                      </Link>
                    )}
                  </span>
                  <span className="text-sm tabular sm:text-right">
                    <span className="text-muted sm:hidden">Pedido: </span>
                    {qtd(linha.quantity, linha.unit)}
                  </span>
                  <span className="text-sm tabular sm:text-right">
                    <span className="text-muted sm:hidden">Chegou: </span>
                    {qtd(linha.receivedQuantity - linha.returnedQuantity, linha.unit)}
                  </span>
                  <span className={`text-sm tabular sm:text-right ${linha.pendingQuantity > 0 && pedido.status !== 'DRAFT' && pedido.status !== 'CANCELED' && !pedido.closedShortAt ? 'font-medium text-warning' : 'text-muted'}`}>
                    <span className="text-muted sm:hidden">Falta: </span>
                    {qtd(linha.pendingQuantity, linha.unit)}
                  </span>
                  <span className="text-sm font-medium tabular sm:text-right">{formatBRL(linha.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1 border-t border-border px-5 py-4 text-sm">
              <Valor rotulo="Peças" valor={formatBRL(pedido.itemsTotalCents)} />
              <Valor rotulo="Frete combinado" valor={formatBRL(pedido.shippingCents)} />
              <Valor rotulo="Total" valor={formatBRL(pedido.totalCents)} forte />
            </div>
          </Card>

          <Historico pedido={pedido} />
        </div>

        <div className="order-first space-y-6 lg:order-none">
          <Card>
            <CardHeader title="Detalhes" />
            <dl className="space-y-2 px-5 py-4 text-sm">
              <Info rotulo="Fornecedor">
                <Link to={`/fornecedores/${pedido.supplier.id}`} className="font-medium hover:underline">
                  {pedido.supplier.name}
                </Link>
              </Info>
              {pedido.supplierQuote && <Info rotulo="Cotação">nº {pedido.supplierQuote.number}</Info>}
              <Info rotulo="Para">{oss.length ? oss.map((o) => `OS ${o.number}`).join(', ') : 'Estoque'}</Info>
              <Info rotulo="Previsão">{pedido.expectedOn ? dataCurta(pedido.expectedOn) : null}</Info>
              <Info rotulo="Pedido por">{pedido.orderedBy?.name}</Info>
              {pedido.notes && <Info rotulo="Observações">{pedido.notes}</Info>}
            </dl>
          </Card>
        </div>
      </div>

      {dialogo === 'pedir' && <PedirDialog pedido={pedido} onClose={() => setDialogo(null)} />}
      {dialogo === 'receber' && <ReceberDialog pedido={pedido} onClose={() => setDialogo(null)} />}
      {dialogo === 'devolver' && <DevolverDialog pedido={pedido} onClose={() => setDialogo(null)} />}
      {dialogo === 'cancelar' && <MotivoDialog pedido={pedido} tipo="cancelar" onClose={() => setDialogo(null)} />}
      {dialogo === 'encerrar' && <MotivoDialog pedido={pedido} tipo="encerrar" onClose={() => setDialogo(null)} />}
    </>
  );
}

function Valor({ rotulo, valor, forte = false }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <p className={`flex justify-between gap-4 ${forte ? 'text-base font-semibold' : ''}`}>
      <span className={forte ? '' : 'text-muted'}>{rotulo}</span>
      <span className="tabular">{valor}</span>
    </p>
  );
}

function Info({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">–</span>}</dd>
    </div>
  );
}

function Historico({ pedido }: { pedido: PurchaseOrder }) {
  if (!pedido.receipts.length && !pedido.returns.length) return null;
  const eventos = [
    ...pedido.receipts.map((r) => ({ quando: r.receivedAt, tipo: 'receipt' as const, r })),
    ...pedido.returns.map((d) => ({ quando: d.returnedAt, tipo: 'return' as const, d })),
  ].sort((a, b) => a.quando.localeCompare(b.quando));
  return (
    <Card>
      <CardHeader title="Recebimentos e devoluções" description="O registro de cada chegada e de cada devolução; não se apaga." />
      <ul className="divide-y divide-border">
        {eventos.map((evento) =>
          evento.tipo === 'receipt' ? (
            <li key={evento.r.id} className="space-y-1 px-5 py-3 text-sm">
              <p className="font-medium">
                Chegada {evento.r.invoiceNumber ? `· ${evento.r.invoiceNumber}` : ''}
                <span className="font-normal text-muted">
                  {' '}
                  · {formatDateTime(evento.r.receivedAt)}
                  {evento.r.receivedBy ? ` · ${evento.r.receivedBy.name}` : ''}
                </span>
              </p>
              <ul className="text-xs text-muted">
                {evento.r.items.map((item) => (
                  <li key={item.purchaseOrderItemId}>
                    {qtd(item.quantity)} × {item.description} — nota {formatBRL(item.unitCostCents)}
                    {item.freightCents > 0 && ` + frete ${formatBRL(item.freightCents)}`} → custo {formatBRL(item.landedUnitCostCents)} cada
                  </li>
                ))}
              </ul>
            </li>
          ) : (
            <li key={evento.d.id} className="space-y-1 px-5 py-3 text-sm">
              <p className="font-medium">
                Devolução ao fornecedor
                <span className="font-normal text-muted">
                  {' '}
                  · {formatDateTime(evento.d.returnedAt)}
                  {evento.d.returnedBy ? ` · ${evento.d.returnedBy.name}` : ''}
                </span>
              </p>
              <p className="text-xs text-muted">Motivo: {evento.d.reason}</p>
              <ul className="text-xs text-muted">
                {evento.d.items.map((item) => (
                  <li key={item.purchaseOrderItemId}>
                    {qtd(item.quantity)} × {item.description} — saiu a {formatBRL(item.unitCostCents)} cada
                  </li>
                ))}
              </ul>
            </li>
          ),
        )}
      </ul>
    </Card>
  );
}

// ================================ diálogos ===================================

function PedirDialog({ pedido, onClose }: { pedido: PurchaseOrder; onClose(): void }) {
  const order = useOrderPurchaseOrder(pedido.id);
  const [expectedOn, setExpectedOn] = useState(pedido.expectedOn ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<OrderedPurchaseOrder | null>(null);

  async function pedir() {
    setErro(null);
    try {
      setFeito(await order.mutateAsync({ version: pedido.version, expectedOn: expectedOn || null }));
    } catch (err) {
      setErro(motivo(err));
    }
  }

  async function copiar() {
    if (!feito) return;
    try {
      await navigator.clipboard.writeText(feito.message);
      toast.success('Mensagem copiada.');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {feito ? (
          <>
            <DialogHeader title={`Pedido nº ${pedido.number} feito`} description="Mande a mensagem ao fornecedor. As peças deste pedido não mudam mais." />
            <pre className="max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-muted/50 p-3 text-xs whitespace-pre-wrap">{feito.message}</pre>
            <DialogFooter>
              <Button variant="secondary" onClick={() => void copiar()}>
                <Copy />
                Copiar mensagem
              </Button>
              {feito.whatsappUrl ? (
                <Button asChild>
                  <a href={feito.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}>
                    <MessageCircle />
                    Enviar pelo WhatsApp
                  </a>
                </Button>
              ) : (
                <Button onClick={onClose}>Fechar</Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader
              title="Marcar como pedido ao fornecedor?"
              description="As peças e quantidades congelam; a mensagem pronta sai na próxima tela. A OS de cada peça registra que ela foi pedida."
            />
            {erro && (
              <Alert variant="danger" className="mb-4">
                {erro}
              </Alert>
            )}
            <Field label="Previsão de entrega" htmlFor="order-expected" hint="Opcional. Vai na mensagem ao fornecedor.">
              <Input id="order-expected" type="date" value={expectedOn} onChange={(event) => setExpectedOn(event.target.value)} />
            </Field>
            <p className="mt-4 text-sm">
              {pedido.items.length} {pedido.items.length === 1 ? 'peça' : 'peças'} · total {formatBRL(pedido.totalCents)}
            </p>
            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>
                Voltar
              </Button>
              <Button loading={order.isPending} onClick={() => void pedir()}>
                Marcar como pedido
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * O que chegou nesta entrega. Tudo vem preenchido com o que falta e o custo
 * combinado; a pessoa corrige pela nota. A conta do custo com frete aparece
 * antes de confirmar — é o custo que vai para o estoque.
 */
function ReceberDialog({ pedido, onClose }: { pedido: PurchaseOrder; onClose(): void }) {
  const receive = useReceivePurchaseOrder(pedido.id);
  // uma chave por formulário: clique duplo ou rede instável não dão entrada duas vezes
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const pendentes = pedido.items.filter((l) => l.pendingQuantity > 0);
  const [valores, setValores] = useState(() =>
    Object.fromEntries(pendentes.map((l) => [l.id, { quantidade: qtd(l.pendingQuantity), custo: formatBRLInput(l.unitCostCents) }])),
  );
  // o frete combinado entra na primeira chegada; nas seguintes, só se houver outro
  const [frete, setFrete] = useState(pedido.receipts.length === 0 && pedido.shippingCents ? formatBRLInput(pedido.shippingCents) : '');
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const linhas = pendentes.map((linha) => {
    const v = valores[linha.id]!;
    const milli = v.quantidade.trim() === '' ? 0 : parseQuantity(v.quantidade);
    const custo = parseBRL(v.custo || 'x');
    const acima = milli !== null && milli > Math.round(linha.pendingQuantity * 1000);
    return { linha, milli, custo, acima };
  });
  const recebendo = linhas.filter((l) => l.milli && l.milli > 0);
  const freteCents = frete.trim() ? parseBRL(frete) : 0;
  const fretes = allocateFreight(
    recebendo.map((l) => (l.custo !== null ? lineValueCents(l.milli!, l.custo) : 0)),
    freteCents ?? 0,
  );
  const invalido = !recebendo.length || linhas.some((l) => l.milli === null || l.acima || (l.milli && l.custo === null)) || freteCents === null;

  async function receber() {
    setErro(null);
    try {
      await receive.mutateAsync({
        clientRequestId,
        invoiceNumber: nota,
        notes: '',
        shippingCents: freteCents ?? 0,
        items: recebendo.map((l) => ({ purchaseOrderItemId: l.linha.id, quantity: l.milli! / 1000, unitCostCents: l.custo! })),
      });
      toast.success('Recebimento registrado. O estoque foi atualizado.');
      onClose();
    } catch (err) {
      setErro(motivo(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader title={`Receber o pedido nº ${pedido.number}`} description="Informe o que chegou nesta entrega. Deixe em branco o que não veio." />
        {erro && (
          <Alert variant="danger" className="mb-4">
            {erro}
          </Alert>
        )}
        <ul className="divide-y divide-border rounded-lg border border-border">
          {linhas.map(({ linha, milli, custo, acima }) => {
            const indice = recebendo.findIndex((r) => r.linha.id === linha.id);
            const landed = indice >= 0 && custo !== null ? landedUnitCostCents(milli!, custo, fretes[indice] ?? 0) : null;
            return (
              <li key={linha.id} className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_8rem] sm:items-start">
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium">{linha.description}</span>
                  <span className="block text-xs text-muted">
                    falta {qtd(linha.pendingQuantity, linha.unit)}
                    {linha.workOrder && ` · para a OS ${linha.workOrder.number}`}
                  </span>
                  {landed !== null && (
                    <span className="block text-xs text-muted tabular">
                      entra no estoque a {formatBRL(landed)} cada
                    </span>
                  )}
                </span>
                <Field label="Chegou" htmlFor={`r-q-${linha.id}`} error={milli === null ? 'Inválida' : acima ? 'Mais que falta' : undefined}>
                  <Input
                    {...fieldA11y(`r-q-${linha.id}`, milli === null || acima ? 'erro' : undefined)}
                    inputMode="decimal"
                    value={valores[linha.id]!.quantidade}
                    onChange={(event) => setValores((atual) => ({ ...atual, [linha.id]: { ...atual[linha.id]!, quantidade: event.target.value } }))}
                  />
                </Field>
                <Field label="Custo na nota" htmlFor={`r-c-${linha.id}`} error={milli && custo === null ? 'Informe' : undefined}>
                  <AdornedInput
                    leading="R$"
                    {...fieldA11y(`r-c-${linha.id}`, milli && custo === null ? 'erro' : undefined)}
                    inputMode="decimal"
                    value={valores[linha.id]!.custo}
                    onChange={(event) => setValores((atual) => ({ ...atual, [linha.id]: { ...atual[linha.id]!, custo: event.target.value } }))}
                  />
                </Field>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Frete desta entrega" htmlFor="r-frete" hint="Dividido no custo das peças pelo valor de cada uma." error={freteCents === null ? 'Valor inválido' : undefined}>
            <AdornedInput leading="R$" {...fieldA11y('r-frete', freteCents === null ? 'erro' : undefined, true)} inputMode="decimal" value={frete} placeholder="0,00" onChange={(event) => setFrete(event.target.value)} />
          </Field>
          <Field label="Nota fiscal" htmlFor="r-nota" hint="Opcional.">
            <Input id="r-nota" value={nota} maxLength={60} onChange={(event) => setNota(event.target.value)} placeholder="Ex.: NF 4521" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button disabled={invalido} loading={receive.isPending} onClick={() => void receber()}>
            Dar entrada no estoque
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DevolverDialog({ pedido, onClose }: { pedido: PurchaseOrder; onClose(): void }) {
  const devolucao = useReturnPurchaseOrder(pedido.id);
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const devolviveis = pedido.items.filter((l: Linha) => l.receivedQuantity - l.returnedQuantity > 0);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [razao, setRazao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const linhas = devolviveis.map((linha) => {
    const texto = quantidades[linha.id] ?? '';
    const milli = texto.trim() === '' ? 0 : parseQuantity(texto);
    const pode = Math.round((linha.receivedQuantity - linha.returnedQuantity) * 1000);
    return { linha, milli, acima: milli !== null && milli > pode };
  });
  const voltando = linhas.filter((l) => l.milli && l.milli > 0);
  const invalido = !voltando.length || linhas.some((l) => l.milli === null || l.acima) || razao.trim().length < 3;

  async function devolver() {
    setErro(null);
    try {
      await devolucao.mutateAsync({
        clientRequestId,
        reason: razao,
        items: voltando.map((l) => ({ purchaseOrderItemId: l.linha.id, quantity: l.milli! / 1000 })),
      });
      toast.success('Devolução registrada. O estoque foi atualizado.');
      onClose();
    } catch (err) {
      setErro(motivo(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader
          title="Devolver ao fornecedor"
          description="Corrige um recebimento: a peça sai do estoque pelo custo com que entrou. Se estava reservada para uma OS, a reserva é desfeita e a peça volta a faltar."
        />
        {erro && (
          <Alert variant="danger" className="mb-4">
            {erro}
          </Alert>
        )}
        <ul className="divide-y divide-border rounded-lg border border-border">
          {linhas.map(({ linha, milli, acima }) => (
            <li key={linha.id} className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-center">
              <span className="min-w-0 text-sm">
                <span className="block truncate font-medium">{linha.description}</span>
                <span className="block text-xs text-muted">
                  chegou {qtd(linha.receivedQuantity - linha.returnedQuantity, linha.unit)}
                  {linha.workOrder && ` · para a OS ${linha.workOrder.number}`}
                </span>
              </span>
              <Field label="Devolver" htmlFor={`d-${linha.id}`} error={milli === null ? 'Inválida' : acima ? 'Mais que chegou' : undefined}>
                <Input
                  {...fieldA11y(`d-${linha.id}`, milli === null || acima ? 'erro' : undefined)}
                  inputMode="decimal"
                  placeholder="0"
                  value={quantidades[linha.id] ?? ''}
                  onChange={(event) => setQuantidades((atual) => ({ ...atual, [linha.id]: event.target.value }))}
                />
              </Field>
            </li>
          ))}
        </ul>
        <Field label="Motivo" htmlFor="d-motivo" className="mt-4">
          <Textarea id="d-motivo" rows={2} value={razao} onChange={(event) => setRazao(event.target.value)} placeholder="Ex.: veio o modelo errado" />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" disabled={invalido} loading={devolucao.isPending} onClick={() => void devolver()}>
            Registrar devolução
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MotivoDialog({ pedido, tipo, onClose }: { pedido: PurchaseOrder; tipo: 'cancelar' | 'encerrar'; onClose(): void }) {
  const cancel = useCancelPurchaseOrder(pedido.id);
  const close = useClosePurchaseOrder(pedido.id);
  const acao = tipo === 'cancelar' ? cancel : close;
  const [razao, setRazao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setErro(null);
    try {
      await acao.mutateAsync(razao);
      toast.success(tipo === 'cancelar' ? 'Pedido cancelado.' : 'Pedido encerrado com o que chegou.');
      onClose();
    } catch (err) {
      setErro(motivo(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={tipo === 'cancelar' ? `Cancelar o pedido nº ${pedido.number}?` : 'Encerrar o que falta?'}
          description={
            tipo === 'cancelar'
              ? pedido.status === 'ORDERED'
                ? 'O pedido já foi ao fornecedor: avise-o também. As OS das peças recebem uma nota de que a peça precisa ser pedida de novo.'
                : 'O rascunho sai da lista de pedidos em aberto.'
              : 'O fornecedor não vai mandar o resto. O pedido fecha com o que chegou, e a peça que faltou volta a precisar de compra.'
          }
        />
        {erro && (
          <Alert variant="danger" className="mb-4">
            {erro}
          </Alert>
        )}
        <Field label="Motivo" htmlFor="motivo-pedido">
          <Textarea id="motivo-pedido" rows={2} value={razao} onChange={(event) => setRazao(event.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant={tipo === 'cancelar' ? 'danger' : 'primary'} disabled={razao.trim().length < 3} loading={acao.isPending} onClick={() => void confirmar()}>
            {tipo === 'cancelar' ? 'Cancelar pedido' : 'Encerrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
