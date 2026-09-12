import {
  availableActions,
  PAYMENT_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_TONES,
  type PaymentStatus,
  type WorkOrder,
  type WorkOrderAction,
  type WorkOrderStatus,
} from '@oficinaos/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useMe } from '../../lib/session';
import { useRunAction } from './api';

export function StatusBadge({ status }: { status: WorkOrderStatus }) {
  return <Badge tone={WORK_ORDER_STATUS_TONES[status]}>{WORK_ORDER_STATUS_LABELS[status]}</Badge>;
}

/** Só aparece quando há saldo em aberto: "a pagar" em tudo seria ruído. */
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  if (status === 'PAID') return <Badge tone="success">{PAYMENT_STATUS_LABELS.PAID}</Badge>;
  if (status === 'PARTIAL') return <Badge tone="warning">{PAYMENT_STATUS_LABELS.PARTIAL}</Badge>;
  return null;
}

/**
 * Botões de status da OS. Quem decide o que aparece é a máquina de estados do
 * shared, cruzada com as permissões do papel — a mesma tabela que a API usa
 * para barrar.
 */
export function StatusActions({ order }: { order: WorkOrder }) {
  const me = useMe();
  const run = useRunAction(order.id);
  const [cancelling, setCancelling] = useState(false);
  const actions = availableActions(order.status, (permission) => me.permissions.includes(permission));

  if (!actions.length) return null;

  async function fire(action: WorkOrderAction, reason?: string) {
    try {
      const updated = await run.mutateAsync({ action, reason });
      toast.success(`OS ${updated.number}: ${WORK_ORDER_STATUS_LABELS[updated.status].toLowerCase()}.`);
      setCancelling(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map(({ action, label, requiresReason }) => (
          <Button
            key={action}
            size="sm"
            variant={action === 'cancel' ? 'ghost' : 'secondary'}
            disabled={run.isPending}
            onClick={() => (requiresReason ? setCancelling(true) : void fire(action))}
          >
            {label}
          </Button>
        ))}
      </div>
      <CancelDialog open={cancelling} onOpenChange={setCancelling} number={order.number} onConfirm={(reason) => fire('cancel', reason)} />
    </>
  );
}

/** Cancelar exige motivo: fica na timeline e na auditoria. */
function CancelDialog({ open, onOpenChange, number, onConfirm }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  number: number;
  onConfirm(reason: string): Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = reason.trim().length < 3;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setReason('');
      }}
    >
      <DialogContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (tooShort) return;
            setBusy(true);
            void onConfirm(reason.trim()).finally(() => setBusy(false));
          }}
        >
          <DialogHeader
            title={`Cancelar a OS ${number}?`}
            description="A OS para de aceitar alterações. O histórico continua guardado."
          />
          <Field label="Motivo do cancelamento" htmlFor="cancel-reason" hint="Aparece na timeline e na auditoria.">
            <Input
              {...fieldA11y('cancel-reason', undefined, true)}
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: cliente desistiu do serviço"
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={tooShort}>
              Cancelar OS
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
