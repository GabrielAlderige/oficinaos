import {
  DISCOUNT_MODES,
  formatBRL,
  formatBRLInput,
  formatQuantity,
  ITEM_SOURCING_LABELS,
  ITEM_SOURCINGS,
  parseBRL,
  parsePercent,
  formatPercentInput,
  WORK_ORDER_EVENT_TYPE_LABELS,
  WORK_ORDER_ITEM_TYPE_LABELS,
  type DiscountMode,
  type ItemSourcing,
  type WorkOrder,
  type WorkOrderItem,
} from '@oficinaos/shared';
import { ClipboardCheck, History, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { usePageCrumb } from '../../app/layouts/crumbs';
import { PlateBadge } from '../../components/plate-badge';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import {
  useAddItem,
  useAddNote,
  useInspections,
  useRemoveItem,
  useTimeline,
  useUpdateItem,
  useUpdateWorkOrder,
  useWorkOrder,
} from './api';
import { PaymentCard } from '../payments/PaymentCard';
import { QuoteCard } from '../quotes/QuoteCard';
import { CheckInDialog } from './CheckInDialog';
import { ItemPicker, parseTypedQuantity } from './ItemPicker';
import { PaymentBadge, StatusActions, StatusBadge } from './status';

export function WorkOrderPage() {
  const { number = '' } = useParams();
  const order = useWorkOrder(Number(number));
  usePageCrumb(order.data ? `OS ${order.data.number}` : undefined);

  if (order.isPending) {
    return (
      <div className="space-y-4" aria-label="Carregando ordem de serviço">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (order.isError) {
    return (
      <Alert variant="danger">
        {errorMessage(order.error)}{' '}
        <Link to="/ordens" className="font-medium underline">
          Voltar para as ordens
        </Link>
      </Alert>
    );
  }
  return <WorkOrderDetail order={order.data} />;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">–</span>}</dd>
    </div>
  );
}

function WorkOrderDetail({ order }: { order: WorkOrder }) {
  const canWrite = useCan('work_orders:write');
  const canDiscount = useCan('work_orders:discount');
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<WorkOrderItem | null>(null);
  const [removing, setRemoving] = useState<WorkOrderItem | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  const addItem = useAddItem(order.id);
  const removeItem = useRemoveItem(order.id);
  const editable = order.status !== 'DELIVERED' && order.status !== 'CANCELED';

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            OS {order.number}
            <StatusBadge status={order.status} />
            <PaymentBadge status={order.paymentStatus} />
          </span>
        }
        description={`Aberta em ${formatDate(order.openedAt)}${order.advisor ? ` por ${order.advisor.name}` : ''}`}
        actions={
          <Button asChild variant="secondary">
            <Link to={`/ordens/${order.number}/imprimir`} target="_blank" rel="noopener noreferrer">
              <Printer />
              Imprimir
            </Link>
          </Button>
        }
      />

      {canWrite && editable && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusActions order={order} />
          <Button size="sm" variant="secondary" onClick={() => setCheckingIn(true)}>
            <ClipboardCheck />
            Check-in
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Itens"
              description="Serviços e peças desta OS. O total é recalculado pela API a cada mudança."
              action={
                canWrite &&
                editable && (
                  <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
                    <Plus />
                    Adicionar
                  </Button>
                )
              }
            />
            {order.items.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">
                Nenhum item ainda. Faça o diagnóstico e adicione serviços e peças — o orçamento sai daqui.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {/* a coluna de ações cabe DOIS botões de 2rem: com menos, eles sobem no preço */}
                {order.items.map((item) => (
                  <li key={item.id} className="grid gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_4.5rem] sm:items-center">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{item.description}</span>
                        {item.isOptional && <Badge tone="info">Recomendado</Badge>}
                        {item.sourcing !== 'STOCK' && <Badge>{ITEM_SOURCING_LABELS[item.sourcing]}</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[
                          WORK_ORDER_ITEM_TYPE_LABELS[item.type],
                          item.brand,
                          item.partCode,
                          item.type === 'PART' && item.availableQuantity !== null && `disponível: ${formatQuantity(Math.round(item.availableQuantity * 1000))}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="text-sm text-muted tabular">
                      {formatQuantity(Math.round(item.quantity * 1000))} × {formatBRL(item.unitPriceCents)}
                    </span>
                    <span className="text-sm font-medium tabular sm:text-right">{formatBRL(item.totalCents)}</span>
                    {canWrite && editable && (
                      <span className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Editar ${item.description}`} onClick={() => setEditing(item)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Remover ${item.description}`} onClick={() => setRemoving(item)}>
                          <Trash2 />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <TotalsFooter order={order} canDiscount={canDiscount && canWrite && editable} />
          </Card>

          <DetailsCard order={order} canWrite={canWrite && editable} />
          <TimelineCard order={order} canWrite={canWrite} />
        </div>

        {/* no celular esta coluna vira o primeiro bloco: o orçamento é a ação do
            dia e não pode ficar embaixo de itens, relato e timeline */}
        <div className="order-first space-y-6 lg:order-none">
          {/* o orçamento é o que o produto inteiro existe para servir: vem primeiro */}
          <QuoteCard order={order} quoteId={order.currentQuote?.id ?? null} />
          <PaymentCard order={order} />
          <Card>
            <CardHeader title="Cliente e veículo" />
            <dl className="px-5 py-3">
              <Info label="Cliente">
                <Link to={`/clientes/${order.customer.id}`} className="font-medium hover:underline">
                  {order.customer.name}
                </Link>
              </Info>
              <Info label="Veículo">
                <Link to={`/veiculos/${order.vehicle.id}`} className="hover:underline">
                  {order.vehicle.make} {order.vehicle.model} {order.vehicle.version}
                </Link>
              </Info>
              <Info label="Placa">
                <PlateBadge plate={order.vehicle.plate} size="sm" />
              </Info>
              <Info label="Km na entrada">{order.odometerKm ? `${order.odometerKm.toLocaleString('pt-BR')} km` : null}</Info>
              <Info label="Previsão">{order.promisedAt ? formatDateTime(order.promisedAt) : null}</Info>
              <Info label="Mecânico">{order.mechanic?.name}</Info>
            </dl>
          </Card>
          <InspectionsCard order={order} />
        </div>
      </div>

      <ItemPicker
        open={picking}
        onOpenChange={setPicking}
        busy={addItem.isPending}
        onPick={async (input) => {
          try {
            await addItem.mutateAsync(input);
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
      {editing && <ItemEditDialog order={order} item={editing} onClose={() => setEditing(null)} />}
      <CheckInDialog order={order} open={checkingIn} onOpenChange={setCheckingIn} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        destructive
        title={removing ? `Remover ${removing.description}?` : 'Remover item?'}
        description="O item sai da OS e o total é recalculado."
        confirmLabel="Remover"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeItem.mutateAsync(removing.id);
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}

/** Totais + desconto geral. O desconto acima do limite volta 403 da API. */
function TotalsFooter({ order, canDiscount }: { order: WorkOrder; canDiscount: boolean }) {
  const update = useUpdateWorkOrder(order.id);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DiscountMode>(order.discountMode ?? 'PERCENT');
  const [value, setValue] = useState(
    order.discountMode === 'AMOUNT' ? formatBRLInput(order.discountValue) : order.discountValue ? formatPercentInput(order.discountValue) : '',
  );

  async function save() {
    const parsed = mode === 'AMOUNT' ? parseBRL(value || '0') : parsePercent(value || '0');
    if (parsed === null) {
      toast.error('Valor inválido.');
      return;
    }
    try {
      await update.mutateAsync({ version: order.version, discountMode: parsed ? mode : null, discountValue: parsed });
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const line = (label: string, cents: number, strong = false) => (
    <div className={cn('flex justify-between gap-4 text-sm', strong && 'text-base font-semibold')}>
      <span className={strong ? '' : 'text-muted'}>{label}</span>
      <span className="tabular">{formatBRL(cents)}</span>
    </div>
  );

  return (
    <div className="space-y-1.5 border-t border-border px-5 py-4">
      {order.totals.servicesSubtotalCents > 0 && line('Mão de obra', order.totals.servicesSubtotalCents)}
      {order.totals.partsSubtotalCents > 0 && line('Peças', order.totals.partsSubtotalCents)}
      {line('Subtotal', order.totals.subtotalCents)}
      {(order.totals.discountCents > 0 || canDiscount) && (
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="flex items-center gap-2 text-muted">
            Desconto
            {canDiscount && (
              <Button variant="link" size="sm" onClick={() => setOpen(true)}>
                {order.totals.discountCents ? 'alterar' : 'aplicar'}
              </Button>
            )}
          </span>
          <span className="tabular text-danger">−{formatBRL(order.totals.discountCents)}</span>
        </div>
      )}
      {order.totals.surchargeCents > 0 && line('Acréscimo', order.totals.surchargeCents)}
      {line('Total', order.totals.totalCents, true)}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader title="Desconto na OS" description="Acima do limite do seu papel, a API pede um gerente." />
          <div className="flex items-end gap-2">
            <Field label="Tipo" htmlFor="discount-mode" className="w-28">
              <Select id="discount-mode" value={mode} onChange={(event) => setMode(event.target.value as DiscountMode)}>
                {DISCOUNT_MODES.map((option) => (
                  <option key={option} value={option}>
                    {option === 'AMOUNT' ? 'R$' : '%'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Valor" htmlFor="discount-value" className="flex-1">
              <AdornedInput
                leading={mode === 'AMOUNT' ? 'R$' : undefined}
                trailing={mode === 'PERCENT' ? '%' : undefined}
                {...fieldA11y('discount-value')}
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="0"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button loading={update.isPending} onClick={() => void save()}>
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemEditDialog({ order, item, onClose }: { order: WorkOrder; item: WorkOrderItem; onClose(): void }) {
  const update = useUpdateItem(order.id);
  const [quantity, setQuantity] = useState(formatQuantity(Math.round(item.quantity * 1000)));
  const [price, setPrice] = useState(formatBRLInput(item.unitPriceCents));
  const [discount, setDiscount] = useState(item.discountCents ? formatBRLInput(item.discountCents) : '');
  const [isOptional, setIsOptional] = useState(item.isOptional);
  const [sourcing, setSourcing] = useState<ItemSourcing>(item.sourcing);

  async function save() {
    const parsedQuantity = parseTypedQuantity(quantity);
    const parsedPrice = parseBRL(price || '0');
    const parsedDiscount = parseBRL(discount || '0');
    if (parsedQuantity === null || parsedPrice === null || parsedDiscount === null) {
      toast.error('Confira quantidade, preço e desconto.');
      return;
    }
    try {
      await update.mutateAsync({
        itemId: item.id,
        quantity: parsedQuantity,
        unitPriceCents: parsedPrice,
        discountCents: parsedDiscount,
        isOptional,
        sourcing,
      });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader title={item.description} description={WORK_ORDER_ITEM_TYPE_LABELS[item.type]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quantidade" htmlFor="item-quantity">
            <Input {...fieldA11y('item-quantity')} inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </Field>
          <Field label="Preço unitário" htmlFor="item-price">
            <AdornedInput leading="R$" {...fieldA11y('item-price')} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          <Field label="Desconto do item" htmlFor="item-discount">
            <AdornedInput leading="R$" {...fieldA11y('item-discount')} inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} placeholder="0,00" />
          </Field>
          {item.type === 'PART' && (
            <Field label="Origem da peça" htmlFor="item-sourcing">
              <Select id="item-sourcing" value={sourcing} onChange={(event) => setSourcing(event.target.value as ItemSourcing)}>
                {ITEM_SOURCINGS.map((value) => (
                  <option key={value} value={value}>
                    {ITEM_SOURCING_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 size-4" checked={isOptional} onChange={(event) => setIsOptional(event.target.checked)} />
            <span>
              Item recomendado
              <span className="block text-xs text-muted">O cliente poderá desmarcar este item ao aprovar o orçamento.</span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={update.isPending} onClick={() => void save()}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Diagnóstico e observações: salvam com a versão da OS (lock otimista). */
function DetailsCard({ order, canWrite }: { order: WorkOrder; canWrite: boolean }) {
  const update = useUpdateWorkOrder(order.id);
  const [complaint, setComplaint] = useState(order.complaint ?? '');
  const [diagnosis, setDiagnosis] = useState(order.diagnosis ?? '');
  const [customerNotes, setCustomerNotes] = useState(order.customerNotes ?? '');
  const [internalNotes, setInternalNotes] = useState(order.internalNotes ?? '');
  const dirty =
    complaint !== (order.complaint ?? '') ||
    diagnosis !== (order.diagnosis ?? '') ||
    customerNotes !== (order.customerNotes ?? '') ||
    internalNotes !== (order.internalNotes ?? '');

  async function save() {
    try {
      await update.mutateAsync({ version: order.version, complaint, diagnosis, customerNotes, internalNotes });
      toast.success('OS atualizada.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader title="Relato e diagnóstico" />
      <div className="grid gap-4 px-5 py-4">
        <Field label="Relato do cliente" htmlFor="wo-complaint">
          <Textarea id="wo-complaint" rows={2} disabled={!canWrite} value={complaint} onChange={(event) => setComplaint(event.target.value)} />
        </Field>
        <Field label="Diagnóstico técnico" htmlFor="wo-diagnosis" hint="O que foi encontrado. Ajuda a justificar o orçamento.">
          <Textarea id="wo-diagnosis" rows={3} disabled={!canWrite} value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} />
        </Field>
        <Field label="Observações para o cliente" htmlFor="wo-customer-notes" hint="Aparece no orçamento e na OS impressa.">
          <Textarea id="wo-customer-notes" rows={2} disabled={!canWrite} value={customerNotes} onChange={(event) => setCustomerNotes(event.target.value)} />
        </Field>
        <Field label="Observações internas" htmlFor="wo-internal-notes" hint="Só a equipe vê.">
          <Textarea id="wo-internal-notes" rows={2} disabled={!canWrite} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} />
        </Field>
      </div>
      {canWrite && (
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          {dirty && <span className="mr-auto text-xs text-muted">Alterações não salvas</span>}
          <Button disabled={!dirty} loading={update.isPending} onClick={() => void save()}>
            Salvar
          </Button>
        </div>
      )}
    </Card>
  );
}

function TimelineCard({ order, canWrite }: { order: WorkOrder; canWrite: boolean }) {
  const timeline = useTimeline(order.id);
  const addNote = useAddNote(order.id);
  const [text, setText] = useState('');

  async function send() {
    if (!text.trim()) return;
    try {
      await addNote.mutateAsync(text.trim());
      setText('');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader title="Timeline" description="O que aconteceu com este carro, na ordem." />
      {canWrite && (
        <div className="flex gap-2 border-b border-border px-5 py-3">
          <Input
            aria-label="Nova observação"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Escreva uma observação"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void send();
            }}
          />
          <Button variant="secondary" loading={addNote.isPending} onClick={() => void send()}>
            Anotar
          </Button>
        </div>
      )}
      {timeline.isPending ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : !timeline.data?.length ? (
        <p className="px-5 py-6 text-center text-sm text-muted">Nada registrado ainda.</p>
      ) : (
        <ul className="divide-y divide-border">
          {timeline.data.map((event) => (
            <li key={event.id} className="flex gap-3 px-5 py-3">
              <History className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{WORK_ORDER_EVENT_TYPE_LABELS[event.type]}</p>
                {typeof event.data.text === 'string' && <p className="text-sm whitespace-pre-line">{event.data.text}</p>}
                {typeof event.data.reason === 'string' && event.data.reason && (
                  <p className="text-sm text-muted">Motivo: {event.data.reason}</p>
                )}
                <p className="text-xs text-muted">
                  {[formatDateTime(event.createdAt), event.actorName].filter(Boolean).join(' · ')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function InspectionsCard({ order }: { order: WorkOrder }) {
  const inspections = useInspections(order.id);
  if (!inspections.data?.length) return null;
  return (
    <Card>
      <CardHeader title="Check-in" />
      <ul className="divide-y divide-border">
        {inspections.data.map((inspection) => {
          const issues = inspection.checklist.filter((entry) => entry.state === 'ISSUE');
          return (
            <li key={inspection.id} className="px-5 py-3 text-sm">
              <p className="font-medium">{formatDateTime(inspection.performedAt)}</p>
              <p className="text-xs text-muted">
                {[
                  inspection.odometerKm && `${inspection.odometerKm.toLocaleString('pt-BR')} km`,
                  `${issues.length} ${issues.length === 1 ? 'ponto de atenção' : 'pontos de atenção'}`,
                  inspection.damages.length ? `${inspection.damages.length} avaria(s)` : null,
                  inspection.performedByName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
