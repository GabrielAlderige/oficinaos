import {
  formatBRL,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  type Invoice,
} from '@oficinaos/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge } from '../../components/ui/display';
import { Input } from '../../components/ui/input';
import { ConfirmDialog, Sheet } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useCancelInvoice } from './api';

/** A ficha da nota: o que saiu, e o botão de cancelar para quem pode. */
export function InvoiceSheet({ invoice, onOpenChange }: { invoice: Invoice | null; onOpenChange: (open: boolean) => void }) {
  const podeCancelar = useCan('invoices:cancel');
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const cancelar = useCancelInvoice(invoice?.id ?? '');

  async function confirmarCancelamento() {
    try {
      await cancelar.mutateAsync(motivo);
      toast.success('Nota cancelada.');
      setMotivo('');
      onOpenChange(false);
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

  return (
    <Sheet open={Boolean(invoice)} onOpenChange={onOpenChange} title="Nota de serviço">
      {invoice && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={INVOICE_STATUS_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
            {invoice.environment === 'SIMULATOR' && <Badge tone="warning">Simulação</Badge>}
          </div>

          <dl className="space-y-1.5">
            <Linha rotulo="Número" valor={invoice.invoiceNumber ?? '—'} />
            <Linha rotulo="RPS" valor={`${invoice.rpsSeries}-${invoice.rpsNumber}`} />
            {invoice.verificationCode && <Linha rotulo="Código de verificação" valor={invoice.verificationCode} />}
            <Linha rotulo="Cliente" valor={invoice.customerName} />
            <Linha rotulo="OS" valor={`nº ${invoice.workOrderNumber}`} />
            {invoice.issuedAt && <Linha rotulo="Emitida em" valor={formatDateTime(invoice.issuedAt)} />}
          </dl>

          <dl className="space-y-1.5 border-t border-border pt-3">
            <Linha rotulo="Serviços" valor={formatBRL(invoice.serviceAmountCents)} />
            {invoice.discountCents > 0 && <Linha rotulo="Desconto" valor={`− ${formatBRL(invoice.discountCents)}`} />}
            <Linha rotulo="Base de cálculo" valor={formatBRL(invoice.baseAmountCents)} />
            <Linha
              rotulo={`ISS (${(invoice.issRateBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)${invoice.issRetained ? ' — retido' : ''}`}
              valor={formatBRL(invoice.issAmountCents)}
            />
            <Linha rotulo="Total" valor={formatBRL(invoice.totalCents)} />
            <Linha rotulo="Líquido" valor={formatBRL(invoice.netCents)} />
          </dl>

          {invoice.rejectionReason && <Alert variant="danger">{invoice.rejectionReason}</Alert>}
          {invoice.cancelReason && (
            <Alert variant="warning">
              Cancelada{invoice.canceledAt ? ` em ${formatDateTime(invoice.canceledAt)}` : ''}: {invoice.cancelReason}
            </Alert>
          )}

          {invoice.publicUrl && (
            <a className="inline-block underline underline-offset-2" href={invoice.publicUrl} target="_blank" rel="noreferrer">
              Ver a nota na prefeitura
            </a>
          )}

          {podeCancelar && invoice.status === 'AUTHORIZED' && (
            <div className="space-y-2 border-t border-border pt-3">
              <label className="block text-sm" htmlFor="motivo-cancelamento">
                Motivo do cancelamento
              </label>
              <Input
                id="motivo-cancelamento"
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                placeholder="Ex.: valor errado na nota"
              />
              <Button
                variant="danger"
                disabled={motivo.trim().length < 5 || cancelar.isPending}
                onClick={() => setConfirmando(true)}
              >
                Cancelar nota
              </Button>
              <p className="text-xs text-muted">
                A prefeitura costuma dar prazo curto para cancelar. Depois do prazo, o caminho é a carta de correção
                com o contador.
              </p>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="Cancelar esta nota?"
        description="A nota é cancelada na prefeitura e não volta atrás. Para cobrar de novo, emita outra."
        confirmLabel="Cancelar nota"
        destructive
        onConfirm={() => void confirmarCancelamento()}
      />
    </Sheet>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="text-right tabular-nums">{valor}</dd>
    </div>
  );
}
