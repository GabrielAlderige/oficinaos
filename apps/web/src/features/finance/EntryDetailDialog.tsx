import {
  formatBRL,
  formatBRLInput,
  parseBRL,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type FinancialEntryDetail,
  type PaymentMethod,
} from '@oficinaos/shared';
import { Ban, Banknote, CalendarClock, Layers, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import {
  useCancelEntry,
  useCancelSettlement,
  useFinancialCategories,
  useFinancialEntry,
  useSettleEntry,
  useSplitEntry,
  useUpdateEntry,
} from './api';
import { dataBR, SituationBadge } from './status';

type Aba = 'resumo' | 'baixa' | 'parcelar' | 'cancelar' | 'editar';

/**
 * A ficha do lançamento: de onde veio, o que já foi baixado e o que fazer com
 * ele. Numa conta de OS, a baixa **é** o pagamento do caixa — a tela diz isso
 * com todas as letras, senão a oficina procura o dinheiro em dois lugares.
 */
export function EntryDetailDialog({ id, onClose }: { id: string | null; onClose(): void }) {
  const consulta = useFinancialEntry(id);
  const [aba, setAba] = useState<Aba>('resumo');

  return (
    <Dialog
      open={Boolean(id)}
      onOpenChange={(aberto) => {
        if (!aberto) {
          setAba('resumo');
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-xl">
        {consulta.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : consulta.isError ? (
          <Alert variant="danger">{errorMessage(consulta.error)}</Alert>
        ) : consulta.data ? (
          <Corpo entry={consulta.data} aba={aba} setAba={setAba} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Corpo({ entry, aba, setAba, onClose }: {
  entry: FinancialEntryDetail;
  aba: Aba;
  setAba(aba: Aba): void;
  onClose(): void;
}) {
  const podeMexer = useCan('finance:write');
  const receber = entry.direction === 'RECEIVABLE';
  const emAberto = entry.status === 'OPEN' || entry.status === 'PARTIAL';

  if (aba === 'baixa') return <BaixaForm entry={entry} onDone={() => setAba('resumo')} />;
  if (aba === 'parcelar') return <ParcelarForm entry={entry} onDone={() => setAba('resumo')} />;
  if (aba === 'cancelar') return <CancelarForm entry={entry} onDone={onClose} onVoltar={() => setAba('resumo')} />;
  if (aba === 'editar') return <EditarForm entry={entry} onDone={() => setAba('resumo')} />;

  return (
    <>
      <DialogHeader
        title={entry.description}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SituationBadge situation={entry.situation} overdueDays={entry.overdueDays} />
            <span>
              {receber ? 'A receber' : 'A pagar'} · vence {dataBR(entry.dueDate)}
              {entry.installmentCount > 1 && ` · parcela ${entry.installmentNumber}/${entry.installmentCount}`}
            </span>
          </span>
        }
      />

      <div className="space-y-4">
        <dl className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-muted/50 px-4 py-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Valor</dt>
            <dd className="mt-0.5 font-semibold tabular">{formatBRL(entry.amountCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{receber ? 'Recebido' : 'Pago'}</dt>
            <dd className="mt-0.5 font-semibold tabular">{formatBRL(entry.paidCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Falta</dt>
            <dd className={cn('mt-0.5 font-semibold tabular', entry.remainingCents > 0 && 'text-accent dark:text-accent-bright')}>
              {formatBRL(entry.remainingCents)}
            </dd>
          </div>
        </dl>

        <dl className="space-y-1.5 text-sm">
          <Linha rotulo="Categoria" valor={entry.categoryName ?? 'Sem categoria'} />
          {entry.customerName && <Linha rotulo="Cliente" valor={entry.customerName} />}
          {entry.supplierName && <Linha rotulo="Fornecedor" valor={entry.supplierName} />}
          {entry.workOrderNumber && (
            <Linha
              rotulo="Origem"
              valor={
                <Link className="underline hover:text-foreground" to={`/ordens/${entry.workOrderNumber}`}>
                  OS nº {entry.workOrderNumber}
                </Link>
              }
            />
          )}
          {entry.purchaseOrderId && (
            <Linha
              rotulo="Origem"
              valor={
                <Link className="underline hover:text-foreground" to={`/compras/${entry.purchaseOrderId}`}>
                  Compra nº {entry.purchaseOrderNumber}
                </Link>
              }
            />
          )}
          {entry.notes && <Linha rotulo="Observação" valor={entry.notes} />}
          {entry.cancelReason && <Linha rotulo="Cancelado" valor={entry.cancelReason} />}
        </dl>

        {entry.workOrderId && (
          <Alert variant="info">
            Esta conta espelha a OS nº {entry.workOrderNumber}: o valor vem do que o cliente aprovou e a baixa é
            registrada no caixa da OS.
          </Alert>
        )}

        <Baixas entry={entry} />
      </div>

      {podeMexer && emAberto && (
        <DialogFooter className="sm:justify-between">
          <span className="flex flex-wrap gap-2">
            {entry.installmentCount === 1 && entry.status === 'OPEN' && (
              <Button variant="ghost" onClick={() => setAba('parcelar')}>
                <Layers />
                Parcelar
              </Button>
            )}
            <Button variant="ghost" onClick={() => setAba('editar')}>
              <Pencil />
              Editar
            </Button>
            {entry.paidCents === 0 && (
              <Button variant="ghost" onClick={() => setAba('cancelar')}>
                <Ban />
                Cancelar conta
              </Button>
            )}
          </span>
          <Button onClick={() => setAba('baixa')}>
            <Banknote />
            {receber ? 'Registrar recebimento' : 'Registrar pagamento'}
          </Button>
        </DialogFooter>
      )}
    </>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="min-w-0 truncate text-right">{valor}</dd>
    </div>
  );
}

function Baixas({ entry }: { entry: FinancialEntryDetail }) {
  const podeMexer = useCan('finance:write');
  const cancelar = useCancelSettlement();
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  if (!entry.settlements.length) {
    return <p className="border-t border-border pt-3 text-sm text-muted">Nenhuma baixa registrada ainda.</p>;
  }

  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-[13px] font-medium">Baixas</h3>
      <ul className="mt-1 divide-y divide-border">
        {entry.settlements.map((baixa) => {
          const cancelada = baixa.status === 'CANCELED';
          return (
            <li key={baixa.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className={cn('min-w-0 truncate', cancelada && 'text-muted line-through')}>
                  {PAYMENT_METHOD_LABELS[baixa.method]}
                  {baixa.paymentId && ' · pelo caixa da OS'}
                </span>
                <span className={cn('shrink-0 tabular', cancelada ? 'text-muted line-through' : 'font-medium')}>
                  {formatBRL(baixa.amountCents)}
                </span>
              </div>
              <p className="text-xs text-muted">
                {[formatDateTime(baixa.paidAt), baixa.recordedByName].filter(Boolean).join(' · ')}
              </p>
              {cancelada ? (
                <p className="mt-0.5 text-xs text-muted">Cancelada{baixa.cancelReason && `: ${baixa.cancelReason}`}</p>
              ) : (
                podeMexer &&
                !baixa.paymentId && (
                  <>
                    {cancelando === baixa.id ? (
                      <div className="mt-1.5 flex gap-2">
                        <Input
                          aria-label="Motivo do cancelamento"
                          autoFocus
                          value={motivo}
                          onChange={(event) => setMotivo(event.target.value)}
                          placeholder="Motivo"
                          className="h-8"
                        />
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={motivo.trim().length < 3}
                          loading={cancelar.isPending}
                          onClick={async () => {
                            try {
                              await cancelar.mutateAsync({ id: baixa.id, reason: motivo.trim() });
                              toast.success('Baixa cancelada.');
                              setCancelando(null);
                              setMotivo('');
                            } catch (err) {
                              toast.error(errorMessage(err));
                            }
                          }}
                        >
                          Confirmar
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mt-0.5 text-xs text-muted underline hover:text-foreground"
                        onClick={() => setCancelando(baixa.id)}
                      >
                        Cancelar baixa
                      </button>
                    )}
                  </>
                )
              )}
              {baixa.paymentId && !cancelada && (
                <p className="mt-0.5 text-xs text-muted">Para estornar, cancele o pagamento na ficha da OS.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BaixaForm({ entry, onDone }: { entry: FinancialEntryDetail; onDone(): void }) {
  const receber = entry.direction === 'RECEIVABLE';
  const baixar = useSettleEntry(entry.id);
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [valor, setValor] = useState(formatBRLInput(entry.remainingCents));
  const [erro, setErro] = useState<string | null>(null);
  // uma chave por abertura do formulário: clique duplo não baixa duas vezes
  const [chave] = useState(() => crypto.randomUUID());

  async function salvar() {
    setErro(null);
    const centavos = parseBRL(valor || '0');
    if (centavos === null || centavos <= 0) return setErro('Informe um valor válido.');
    try {
      await baixar.mutateAsync({ clientRequestId: chave, amountCents: centavos, method, paidAt: null, notes: '' });
      toast.success(receber ? 'Recebimento registrado.' : 'Pagamento registrado.');
      onDone();
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <>
      <DialogHeader
        title={receber ? 'Registrar recebimento' : 'Registrar pagamento'}
        description={`${entry.description} · falta ${formatBRL(entry.remainingCents)}.`}
      />
      <div className="space-y-4">
        {erro && <Alert variant="danger">{erro}</Alert>}
        {entry.workOrderNumber && (
          <Alert variant="info">
            Entra no caixa da OS nº {entry.workOrderNumber}
            {entry.installmentCount > 1 && ', quitando as parcelas mais antigas primeiro'}.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Forma" htmlFor="settle-method">
            <Select id="settle-method" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((valorMetodo) => (
                <option key={valorMetodo} value={valorMetodo}>
                  {PAYMENT_METHOD_LABELS[valorMetodo]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor" htmlFor="settle-amount">
            <AdornedInput
              {...fieldA11y('settle-amount')}
              leading="R$"
              inputMode="numeric"
              value={valor}
              onChange={(event) => setValor(formatBRLInput(parseBRL(event.target.value) ?? 0))}
            />
          </Field>
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Voltar
        </Button>
        <Button loading={baixar.isPending} onClick={() => void salvar()}>
          Registrar
        </Button>
      </DialogFooter>
    </>
  );
}

function ParcelarForm({ entry, onDone }: { entry: FinancialEntryDetail; onDone(): void }) {
  const parcelar = useSplitEntry(entry.id);
  const [quantidade, setQuantidade] = useState('3');
  const [primeiro, setPrimeiro] = useState(entry.dueDate);
  const [erro, setErro] = useState<string | null>(null);
  const numero = Math.max(2, Math.min(48, Number(quantidade) || 2));

  return (
    <>
      <DialogHeader
        title="Parcelar"
        description={`${formatBRL(entry.amountCents)} em ${numero}× de ${formatBRL(Math.floor(entry.amountCents / numero))}, uma por mês.`}
      />
      <div className="space-y-4">
        {erro && <Alert variant="danger">{erro}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Parcelas" htmlFor="split-count">
            <Input
              {...fieldA11y('split-count')}
              inputMode="numeric"
              value={quantidade}
              onChange={(event) => setQuantidade(event.target.value.replace(/\D/g, '').slice(0, 2))}
            />
          </Field>
          <Field label="Primeiro vencimento" htmlFor="split-due">
            <Input
              {...fieldA11y('split-due')}
              type="date"
              value={primeiro}
              onChange={(event) => setPrimeiro(event.target.value)}
            />
          </Field>
        </div>
        <p className="flex gap-2 text-xs text-muted">
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />A sobra dos centavos vai para a
          primeira parcela, e o que já foi pago quita as mais antigas.
        </p>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Voltar
        </Button>
        <Button
          loading={parcelar.isPending}
          onClick={async () => {
            setErro(null);
            try {
              await parcelar.mutateAsync({ installments: numero, firstDueDate: primeiro });
              toast.success(`Parcelado em ${numero}×.`);
              onDone();
            } catch (err) {
              setErro(errorMessage(err));
            }
          }}
        >
          Parcelar
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Editar o que é da oficina: descrição, categoria, vencimento e observação. O
 * VALOR de uma conta de OS não entra aqui — ele é o que o cliente aprovou, e
 * muda na OS (a API recusa, e a tela nem oferece).
 */
function EditarForm({ entry, onDone }: { entry: FinancialEntryDetail; onDone(): void }) {
  const salvar = useUpdateEntry(entry.id);
  const categorias = useFinancialCategories();
  const daDirecao = (categorias.data ?? []).filter((c) => c.direction === entry.direction);
  const espelhada = entry.origin === 'WORK_ORDER';

  const [descricao, setDescricao] = useState(entry.description);
  const [categoria, setCategoria] = useState(entry.categoryId ?? '');
  const [valor, setValor] = useState(formatBRLInput(entry.amountCents));
  const [vencimento, setVencimento] = useState(entry.dueDate);
  const [notas, setNotas] = useState(entry.notes ?? '');
  const [erro, setErro] = useState<string | null>(null);

  return (
    <>
      <DialogHeader title="Editar lançamento" description={entry.description} />
      <div className="space-y-4">
        {erro && <Alert variant="danger">{erro}</Alert>}
        <Field label="Descrição" htmlFor="edit-description">
          <Input
            {...fieldA11y('edit-description')}
            value={descricao}
            onChange={(event) => setDescricao(event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria" htmlFor="edit-category">
            <Select id="edit-category" value={categoria} onChange={(event) => setCategoria(event.target.value)}>
              {daDirecao.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vencimento" htmlFor="edit-due">
            <Input
              {...fieldA11y('edit-due')}
              type="date"
              value={vencimento}
              onChange={(event) => setVencimento(event.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Valor"
          htmlFor="edit-amount"
          hint={espelhada ? `Vem da OS nº ${entry.workOrderNumber}: mude o valor lá.` : undefined}
        >
          <AdornedInput
            {...fieldA11y('edit-amount', undefined, espelhada)}
            leading="R$"
            inputMode="numeric"
            disabled={espelhada}
            value={valor}
            onChange={(event) => setValor(formatBRLInput(parseBRL(event.target.value) ?? 0))}
          />
        </Field>
        <Field label="Observação" htmlFor="edit-notes">
          <Textarea id="edit-notes" rows={2} value={notas} onChange={(event) => setNotas(event.target.value)} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Voltar
        </Button>
        <Button
          loading={salvar.isPending}
          onClick={async () => {
            setErro(null);
            const centavos = parseBRL(valor || '0') ?? 0;
            if (descricao.trim().length < 2) return setErro('Descreva o lançamento.');
            if (!espelhada && centavos <= 0) return setErro('Informe um valor válido.');
            try {
              await salvar.mutateAsync({
                description: descricao.trim(),
                categoryId: categoria || undefined,
                dueDate: vencimento,
                notes: notas,
                ...(espelhada ? {} : { amountCents: centavos }),
              });
              toast.success('Lançamento salvo.');
              onDone();
            } catch (err) {
              setErro(errorMessage(err));
            }
          }}
        >
          Salvar
        </Button>
      </DialogFooter>
    </>
  );
}

function CancelarForm({ entry, onDone, onVoltar }: {
  entry: FinancialEntryDetail;
  onDone(): void;
  onVoltar(): void;
}) {
  const cancelar = useCancelEntry(entry.id);
  const [motivo, setMotivo] = useState('');

  return (
    <>
      <DialogHeader
        title="Cancelar a conta?"
        description="Ela continua no histórico, marcada como cancelada, com o motivo e quem cancelou."
      />
      <Field label="Motivo" htmlFor="cancel-entry-reason" hint="Aparece no histórico e na auditoria.">
        <Input
          {...fieldA11y('cancel-entry-reason', undefined, true)}
          autoFocus
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
          placeholder="Ex.: lançada em duplicidade"
        />
      </Field>
      <DialogFooter>
        <Button variant="secondary" onClick={onVoltar}>
          Voltar
        </Button>
        <Button
          variant="danger"
          disabled={motivo.trim().length < 3}
          loading={cancelar.isPending}
          onClick={async () => {
            try {
              await cancelar.mutateAsync(motivo.trim());
              toast.success('Conta cancelada.');
              onDone();
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          Cancelar conta
        </Button>
      </DialogFooter>
    </>
  );
}
