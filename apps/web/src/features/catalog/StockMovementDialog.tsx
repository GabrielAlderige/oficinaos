import { zodResolver } from '@hookform/resolvers/zod';
import { parseQuantity, stockAdjustmentFormSchema, stockEntryFormSchema, type Part } from '@oficinaos/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useMoveStock } from './api';
import { formatQty } from './stock';

export type MovementMode = 'ENTRY' | 'ADJUSTMENT';

/** Entrada (chegou peça) ou ajuste de contagem (a prateleira não bate com o sistema). */
export function StockMovementDialog({ part, mode, onClose }: { part: Part; mode: MovementMode | null; onClose(): void }) {
  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {mode === 'ENTRY' && <EntryForm part={part} onDone={onClose} />}
        {mode === 'ADJUSTMENT' && <AdjustmentForm part={part} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

const unitLabel = (part: Part) => formatQty(0, part.unit).replace(/^0\s*/, '');

/** Quantidade digitada → número, ou null enquanto não é válida. */
const typed = (text: string) => {
  const milli = parseQuantity(text || 'x');
  return milli === null ? null : milli / 1000;
};

function EntryForm({ part, onDone }: { part: Part; onDone(): void }) {
  const move = useMoveStock();
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors: e, isSubmitting },
  } = useForm({ resolver: zodResolver(stockEntryFormSchema), defaultValues: { quantity: '', unitCost: '', reason: '' } });

  const quantity = typed(watch('quantity'));
  const onSubmit = handleSubmit(async (values) => {
    try {
      await move.mutateAsync({ ...values, partId: part.id });
      toast.success(`Entrada de ${formatQty(values.quantity, part.unit)} registrada.`);
      onDone();
    } catch (err) {
      if (!applyFieldErrors(err, setError, { unitCostCents: 'unitCost' })) setError('root', { message: errorMessage(err) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader title="Entrada de estoque" description={`${part.name} · hoje: ${formatQty(part.quantityOnHand, part.unit)}`} />
      <div className="space-y-4">
        {e.root?.message && <Alert variant="danger">{e.root.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Quantidade que entrou"
            htmlFor="m-qty"
            error={e.quantity?.message}
            hint={quantity !== null && quantity > 0 ? `Vai ficar com ${formatQty(part.quantityOnHand + quantity, part.unit)}` : undefined}
          >
            <AdornedInput trailing={unitLabel(part)} {...fieldA11y('m-qty', e.quantity?.message, true)} autoFocus inputMode="decimal" placeholder="0" {...register('quantity')} />
          </Field>
          {!part.costHidden && (
            <Field label="Custo unitário" htmlFor="m-cost" error={e.unitCost?.message} hint="Opcional. Atualiza o custo médio.">
              <AdornedInput leading="R$" {...fieldA11y('m-cost', e.unitCost?.message, true)} inputMode="decimal" placeholder="0,00" {...register('unitCost')} />
            </Field>
          )}
        </div>
        <Field label="Observação" htmlFor="m-reason" error={e.reason?.message}>
          <Input {...fieldA11y('m-reason', e.reason?.message)} placeholder="Ex.: NF 1234, Distribuidora Central" {...register('reason')} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Registrar entrada
        </Button>
      </DialogFooter>
    </form>
  );
}

function AdjustmentForm({ part, onDone }: { part: Part; onDone(): void }) {
  const move = useMoveStock();
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors: e, isSubmitting },
  } = useForm({ resolver: zodResolver(stockAdjustmentFormSchema), defaultValues: { countedQuantity: '', reason: '' } });

  const counted = typed(watch('countedQuantity'));
  const diff = counted === null ? null : Math.round((counted - part.quantityOnHand) * 1000) / 1000;
  const onSubmit = handleSubmit(async (values) => {
    try {
      await move.mutateAsync({ ...values, partId: part.id });
      toast.success(`Estoque ajustado para ${formatQty(values.countedQuantity, part.unit)}.`);
      onDone();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setError('root', { message: errorMessage(err) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader
        title="Ajustar contagem"
        description={`${part.name} · no sistema: ${formatQty(part.quantityOnHand, part.unit)}. Informe quanto tem de fato na prateleira.`}
      />
      <div className="space-y-4">
        {e.root?.message && <Alert variant="danger">{e.root.message}</Alert>}
        <Field label="Quantidade contada" htmlFor="a-qty" error={e.countedQuantity?.message}>
          <AdornedInput trailing={unitLabel(part)} {...fieldA11y('a-qty', e.countedQuantity?.message)} autoFocus inputMode="decimal" placeholder="0" {...register('countedQuantity')} />
        </Field>
        {diff !== null && (
          <p className={cn('text-sm', diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted')} role="status">
            {diff === 0
              ? 'Igual ao que está no sistema: não há o que ajustar.'
              : `Diferença: ${diff > 0 ? '+' : '−'}${formatQty(Math.abs(diff), part.unit)}`}
          </p>
        )}
        <Field label="Motivo" htmlFor="a-reason" error={e.reason?.message} hint="Fica registrado no histórico, com o seu nome.">
          <Input {...fieldA11y('a-reason', e.reason?.message, true)} placeholder="Ex.: contagem do mês, peça danificada" {...register('reason')} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting} disabled={diff === 0}>
          Ajustar estoque
        </Button>
      </DialogFooter>
    </form>
  );
}
