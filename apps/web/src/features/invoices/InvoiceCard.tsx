import {
  formatBRL,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  type Invoice,
  type WorkOrder,
} from '@oficinaos/shared';
import { FileCheck2, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader } from '../../components/ui/display';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { InvoiceSheet } from './InvoiceSheet';
import { InvoiceIssueDialog } from './InvoiceIssueDialog';
import { useInvoicesOfWorkOrder } from './api';

/**
 * A nota de serviço desta OS (E18). Aparece quando a OS está finalizada ou
 * entregue — antes disso não há serviço prestado para documentar.
 */
export function InvoiceCard({ order }: { order: WorkOrder }) {
  const podeVer = useCan('invoices:read');
  const podeEmitir = useCan('invoices:issue');
  const jaTerminou = order.status === 'COMPLETED' || order.status === 'DELIVERED';
  const notas = useInvoicesOfWorkOrder(order.id, podeVer && jaTerminou);
  const [emitindo, setEmitindo] = useState(false);
  const [aberta, setAberta] = useState<Invoice | null>(null);

  if (!podeVer || !jaTerminou) return null;

  const lista = notas.data?.data ?? [];
  const viva = lista.find((nota) => nota.status === 'AUTHORIZED' || nota.status === 'QUEUED');

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Nota fiscal
            {viva && <Badge tone={INVOICE_STATUS_TONES[viva.status]}>{INVOICE_STATUS_LABELS[viva.status]}</Badge>}
            {viva?.environment === 'SIMULATOR' && <Badge tone="warning">Simulação</Badge>}
          </span>
        }
        description="Nota de serviço (NFS-e). As peças desta OS não entram nela."
      />

      <div className="space-y-3 px-5 py-4 text-sm">
        {notas.isError && <Alert variant="danger">{errorMessage(notas.error)}</Alert>}

        {viva ? (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted">Número</span>
              <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setAberta(viva)}>
                {viva.invoiceNumber ?? `RPS ${viva.rpsSeries}-${viva.rpsNumber}`}
              </button>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted">Valor</span>
              <span className="tabular-nums">{formatBRL(viva.totalCents)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted">ISS{viva.issRetained ? ' (retido)' : ''}</span>
              <span className="tabular-nums">{formatBRL(viva.issAmountCents)}</span>
            </div>
            {viva.issuedAt && (
              <div className="flex justify-between gap-4">
                <span className="text-muted">Emitida em</span>
                <span>{formatDateTime(viva.issuedAt)}</span>
              </div>
            )}
            {viva.environment === 'SIMULATOR' && (
              <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
                <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Simulação: nenhum documento fiscal foi emitido.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-muted">
              {lista.length
                ? 'A nota desta OS foi cancelada. Dá para emitir outra.'
                : 'Esta OS ainda não tem nota de serviço.'}
            </p>
            {podeEmitir && (
              <Button size="sm" variant="secondary" onClick={() => setEmitindo(true)}>
                <FileCheck2 />
                Emitir nota
              </Button>
            )}
          </>
        )}
      </div>

      <InvoiceIssueDialog workOrderId={order.id} open={emitindo} onOpenChange={setEmitindo} />
      <InvoiceSheet invoice={aberta} onOpenChange={(open) => !open && setAberta(null)} />
    </Card>
  );
}
