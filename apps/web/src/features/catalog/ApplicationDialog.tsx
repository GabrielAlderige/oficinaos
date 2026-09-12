import { zodResolver } from '@hookform/resolvers/zod';
import { partApplicationFormSchema } from '@oficinaos/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useAddApplication } from './api';

/** Em que carro a peça serve: é o que faz "pastilha gol 2012" achar a peça certa. */
export function ApplicationDialog({ partId, open, onOpenChange }: { partId: string; open: boolean; onOpenChange(open: boolean): void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ApplicationForm partId={partId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ApplicationForm({ partId, onDone }: { partId: string; onDone(): void }) {
  const add = useAddApplication(partId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors: e, isSubmitting },
  } = useForm({
    resolver: zodResolver(partApplicationFormSchema),
    defaultValues: { make: '', model: '', engine: '', yearFrom: '', yearTo: '', notes: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await add.mutateAsync(values);
      toast.success(`${[values.make, values.model].filter(Boolean).join(' ')} adicionado.`);
      onDone();
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setError('root', { message: errorMessage(err) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader title="Adicionar carro" description="Deixe os anos em branco se a peça serve em todos." />
      <div className="space-y-4">
        {e.root?.message && <Alert variant="danger">{e.root.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marca" htmlFor="ap-make" error={e.make?.message}>
            <Input {...fieldA11y('ap-make', e.make?.message)} autoFocus placeholder="Ex.: Volkswagen" {...register('make')} />
          </Field>
          <Field label="Modelo" htmlFor="ap-model" error={e.model?.message}>
            <Input {...fieldA11y('ap-model', e.model?.message)} placeholder="Ex.: Gol" {...register('model')} />
          </Field>
          <Field label="Motor" htmlFor="ap-engine" error={e.engine?.message}>
            <Input {...fieldA11y('ap-engine', e.engine?.message)} placeholder="Ex.: 1.0" {...register('engine')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="De (ano)" htmlFor="ap-from" error={e.yearFrom?.message}>
              <Input {...fieldA11y('ap-from', e.yearFrom?.message)} inputMode="numeric" maxLength={4} placeholder="2008" {...register('yearFrom')} />
            </Field>
            <Field label="Até (ano)" htmlFor="ap-to" error={e.yearTo?.message}>
              <Input {...fieldA11y('ap-to', e.yearTo?.message)} inputMode="numeric" maxLength={4} placeholder="2016" {...register('yearTo')} />
            </Field>
          </div>
          <Field label="Observação" htmlFor="ap-notes" error={e.notes?.message} className="sm:col-span-2">
            <Input {...fieldA11y('ap-notes', e.notes?.message)} placeholder="Ex.: só com freio a disco" {...register('notes')} />
          </Field>
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Adicionar
        </Button>
      </DialogFooter>
    </form>
  );
}
