import {
  formatBRL,
  formatBRLInput,
  parseBRL,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_STATUS_LABELS,
  type Payment,
  type PaymentMethod,
  type WorkOrder,
} from '@oficinaos/shared';
import { Banknote } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useCancelPayment, usePayments, useRecordPayment } from './api';

const TOM = { PAID: 'success', PARTIAL: 'warning', UNPAID: 'neutral' } as const;

/**
 * O caixa da oficina. Quem soma é a API (lançamentos confirmados); a tela só
 * mostra e registra — por isso "recebido" e "falta" vêm da resposta, nunca de
 * uma conta feita aqui.
 */
export function PaymentCard({ order }: { order: WorkOrder }) {
  const canRecord = useCan('payments:record');
  const canCancel = useCan('payments:cancel');
  const payments = usePayments(order.id);
  const [recording, setRecording] = useState(false);
  const [cancelling, setCancelling] = useState<Payment | null>(null);

  const lista = payments.data;
  const falta = lista?.balanceCents ?? 0;
  const recebido = lista?.paidCents ?? order.totals.paidCents;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Pagamento
            <Badge tone={TOM[order.paymentStatus]}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge>
          </span>
        }
        description={order.status === 'CANCELED' ? 'OS cancelada: não recebe pagamento.' : undefined}
      />

      <div className="space-y-4 px-5 py-4">
        {payments.isError ? (
          <Alert variant="danger">{errorMessage(payments.error)}</Alert>
        ) : (
          <>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Recebido</dt>
                <dd className="tabular font-medium">{formatBRL(recebido)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Falta</dt>
                <dd className={cn('tabular font-medium', falta > 0 && 'text-accent dark:text-accent-bright')}>
                  {formatBRL(falta)}
                </dd>
              </div>
            </dl>

            {canRecord && falta > 0 && order.status !== 'CANCELED' && (
              <Button onClick={() => setRecording(true)}>
                <Banknote />
                Registrar pagamento
              </Button>
            )}

            {lista?.data.length ? (
              <ul className="divide-y divide-border border-t border-border">
                {lista.data.map((pagamento) => {
                  const cancelado = pagamento.status === 'CANCELED';
                  return (
                    <li key={pagamento.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('min-w-0 truncate', cancelado && 'text-muted line-through')}>
                          {PAYMENT_METHOD_LABELS[pagamento.method]}
                          {pagamento.installments > 1 && ` em ${pagamento.installments}×`}
                        </span>
                        <span className={cn('tabular shrink-0', cancelado ? 'text-muted line-through' : 'font-medium')}>
                          {formatBRL(pagamento.amountCents)}
                        </span>
                      </div>
                      <p className="text-xs text-muted">
                        {[formatDateTime(pagamento.paidAt), pagamento.recordedByName].filter(Boolean).join(' · ')}
                      </p>
                      {cancelado ? (
                        <p className="mt-0.5 text-xs text-muted">
                          Cancelado{pagamento.cancelReason && `: ${pagamento.cancelReason}`}
                        </p>
                      ) : (
                        canCancel && (
                          <button
                            type="button"
                            className="mt-0.5 text-xs text-muted underline hover:text-foreground"
                            onClick={() => setCancelling(pagamento)}
                          >
                            Cancelar lançamento
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              !payments.isPending && <p className="text-sm text-muted">Nada recebido ainda.</p>
            )}
          </>
        )}
      </div>

      <RecordDialog order={order} falta={falta} open={recording} onOpenChange={setRecording} />
      <CancelDialog order={order} payment={cancelling} onClose={() => setCancelling(null)} />
    </Card>
  );
}

function RecordDialog({ order, falta, open, onOpenChange }: {
  order: WorkOrder;
  falta: number;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <RecordBody order={order} falta={falta} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RecordBody({ order, falta, onDone }: { order: WorkOrder; falta: number; onDone(): void }) {
  const registrar = useRecordPayment(order.id, order.number);
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  // já vem com o que falta: no balcão, receber o restante é o caso comum
  const [valor, setValor] = useState(formatBRLInput(falta));
  const [parcelas, setParcelas] = useState('1');
  const [notas, setNotas] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const noCartao = method === 'CREDIT_CARD';

  async function salvar() {
    setErro(null);
    const centavos = parseBRL(valor || '0');
    if (centavos === null || centavos <= 0) {
      setErro('Informe um valor válido.');
      return;
    }
    try {
      await registrar.mutateAsync({
        method,
        amountCents: centavos,
        installments: noCartao ? Number(parcelas) || 1 : 1,
        notes: notas,
      });
      toast.success('Pagamento registrado.');
      onDone();
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <>
      <DialogHeader
        title="Registrar pagamento"
        description={`OS ${order.number} · falta receber ${formatBRL(falta)}.`}
      />
      <div className="space-y-4">
        {erro && <Alert variant="danger">{erro}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Forma" htmlFor="payment-method">
            <Select id="payment-method" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_METHOD_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor" htmlFor="payment-amount">
            <Input
              {...fieldA11y('payment-amount', undefined, true)}
              inputMode="numeric"
              value={valor}
              onChange={(event) => setValor(formatBRLInput(parseBRL(event.target.value) ?? 0))}
            />
          </Field>
        </div>

        {noCartao && (
          <Field label="Parcelas" htmlFor="payment-installments" hint="Só registro: a cobrança é feita na maquininha.">
            <Input
              {...fieldA11y('payment-installments', undefined, true)}
              inputMode="numeric"
              value={parcelas}
              onChange={(event) => setParcelas(event.target.value.replace(/\D/g, '').slice(0, 2))}
            />
          </Field>
        )}

        <Field label="Observação" htmlFor="payment-notes">
          <Textarea
            id="payment-notes"
            rows={2}
            value={notas}
            onChange={(event) => setNotas(event.target.value)}
            placeholder="Ex.: sinal combinado por telefone"
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button loading={registrar.isPending} onClick={() => void salvar()}>
          Registrar
        </Button>
      </DialogFooter>
    </>
  );
}

/** Cancelar exige motivo: o lançamento continua no histórico, marcado. */
function CancelDialog({ order, payment, onClose }: {
  order: WorkOrder;
  payment: Payment | null;
  onClose(): void;
}) {
  const cancelar = useCancelPayment(order.id, order.number);
  const [reason, setReason] = useState('');
  const curto = reason.trim().length < 3;

  async function confirmar() {
    if (!payment) return;
    try {
      await cancelar.mutateAsync({ id: payment.id, reason: reason.trim() });
      toast.success('Lançamento cancelado.');
      setReason('');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog
      open={Boolean(payment)}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Cancelar o lançamento?"
          description={
            payment
              ? `${PAYMENT_METHOD_LABELS[payment.method]} de ${formatBRL(payment.amountCents)}. O saldo volta a ficar em aberto.`
              : undefined
          }
        />
        <Field label="Motivo" htmlFor="cancel-payment-reason" hint="Aparece no histórico e na auditoria.">
          <Input
            {...fieldA11y('cancel-payment-reason', undefined, true)}
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: lançado em duplicidade"
          />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" loading={cancelar.isPending} disabled={curto} onClick={() => void confirmar()}>
            Cancelar lançamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
