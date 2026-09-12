import { zodResolver } from '@hookform/resolvers/zod';
import {
  effectiveServicePrice,
  formatBRL,
  formatBRLInput,
  parseQuantity,
  PRICING_MODE_LABELS,
  PRICING_MODES,
  SERVICE_CATEGORY_SUGGESTIONS,
  serviceFormSchema,
  type Service,
  type ServiceForm,
} from '@oficinaos/shared';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useOrganizationSettings } from '../settings/api';
import { useDeleteService, useSaveService } from './api';

const hoursFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3, useGrouping: false });

function toFormValues(service?: Service): ServiceForm {
  return {
    name: service?.name ?? '',
    category: service?.category ?? '',
    description: service?.description ?? '',
    pricingMode: service?.pricingMode ?? 'FIXED',
    price: service?.priceCents != null ? formatBRLInput(service.priceCents) : '',
    estimatedHours: service?.estimatedMinutes ? hoursFormat.format(service.estimatedMinutes / 60) : '',
    intervalKm: service?.intervalKm ? String(service.intervalKm) : '',
    intervalMonths: service?.intervalMonths ? String(service.intervalMonths) : '',
    isActive: service?.isActive ?? true,
  };
}

/** A API fala em centavos e minutos; a pessoa digita reais e horas. */
const API_TO_FORM = { priceCents: 'price', estimatedMinutes: 'estimatedHours' };

/** O formulário vive DENTRO do conteúdo do diálogo: cada abertura começa do zero. */
export function ServiceFormDialog({ open, onOpenChange, service }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  service?: Service;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <ServiceFormBody service={service} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ServiceFormBody({ service, onDone }: { service?: Service; onDone(): void }) {
  const save = useSaveService();
  const remove = useDeleteService();
  const settings = useOrganizationSettings();
  const canManageOrg = useCan('organization:manage');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors: e, isSubmitting },
  } = useForm({ resolver: zodResolver(serviceFormSchema), defaultValues: toFormValues(service) });

  const mode = watch('pricingMode');
  const hoursMilli = parseQuantity(watch('estimatedHours') || 'x');
  const minutes = hoursMilli && hoursMilli > 0 ? Math.round((hoursMilli * 60) / 1000) : null;
  const laborRate = settings.data?.laborRateCents ?? null;
  const hourlyPrice = effectiveServicePrice({ pricingMode: 'HOURLY', priceCents: null, estimatedMinutes: minutes }, laborRate);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync({ id: service?.id, body: values });
      toast.success(service ? 'Serviço atualizado.' : `${saved.name} cadastrado.`);
      onDone();
    } catch (err) {
      if (!applyFieldErrors(err, setError, API_TO_FORM)) setError('root', { message: errorMessage(err) });
    }
  });

  const hourlyHint =
    mode !== 'HOURLY' ? (
      'Opcional no preço fixo. Ajuda a planejar o dia da oficina.'
    ) : laborRate === null ? (
      <>
        O valor da hora técnica ainda não foi definido
        {canManageOrg && (
          <>
            {' '}
            (
            <Link to="/configuracoes/precos" className="underline" onClick={onDone}>
              definir agora
            </Link>
            )
          </>
        )}
        .
      </>
    ) : hourlyPrice !== null ? (
      `= ${formatBRL(hourlyPrice)} com a hora a ${formatBRL(laborRate)}`
    ) : (
      `Hora técnica: ${formatBRL(laborRate)}. Ex.: 1,5 = 1h30`
    );

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader
        title={service ? 'Editar serviço' : 'Novo serviço'}
        description={service ? undefined : 'Preço fixo (troca de óleo, alinhamento) ou por hora técnica × tempo padrão (diagnóstico, embreagem).'}
      />
      <div className="space-y-4">
        {e.root?.message && <Alert variant="danger">{e.root.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do serviço" htmlFor="s-name" error={e.name?.message} className="sm:col-span-2">
            <Input {...fieldA11y('s-name', e.name?.message)} autoFocus autoComplete="off" placeholder="Ex.: Troca de óleo e filtro" {...register('name')} />
          </Field>
          <Field label="Categoria" htmlFor="s-category" error={e.category?.message} className="sm:col-span-2">
            <Input {...fieldA11y('s-category', e.category?.message)} list="service-categories" autoComplete="off" placeholder="Ex.: Revisão" {...register('category')} />
            <datalist id="service-categories">
              {SERVICE_CATEGORY_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>

        <div role="radiogroup" aria-label="Forma de cobrança" className="inline-flex rounded-lg border border-border p-0.5">
          {PRICING_MODES.map((option) => (
            <label
              key={option}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-bright',
                mode === option ? 'bg-surface-muted font-medium text-foreground' : 'text-muted hover:text-foreground',
              )}
            >
              <input type="radio" value={option} className="sr-only" {...register('pricingMode')} />
              {PRICING_MODE_LABELS[option]}
            </label>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'FIXED' && (
            <Field label="Preço" htmlFor="s-price" error={e.price?.message}>
              <AdornedInput leading="R$" {...fieldA11y('s-price', e.price?.message)} inputMode="decimal" placeholder="0,00" {...register('price')} />
            </Field>
          )}
          <Field
            label={mode === 'HOURLY' ? 'Tempo padrão (horas)' : 'Tempo padrão (horas, opcional)'}
            htmlFor="s-hours"
            error={e.estimatedHours?.message}
            hint={hourlyHint}
            className={mode === 'HOURLY' ? 'sm:col-span-2' : undefined}
          >
            <AdornedInput trailing="h" {...fieldA11y('s-hours', e.estimatedHours?.message, true)} inputMode="decimal" placeholder="1,5" {...register('estimatedHours')} />
          </Field>
        </div>

        <details className="group rounded-lg border border-border" open={Boolean(service?.intervalKm || service?.intervalMonths)}>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium select-none marker:hidden">
            Intervalo de manutenção <span className="font-normal text-muted">(opcional)</span>
          </summary>
          <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
            <p className="text-xs text-muted sm:col-span-2">
              De quanto em quanto tempo o serviço se repete. É a base do lembrete de “próxima troca” para o cliente.
            </p>
            <Field label="A cada (km)" htmlFor="s-km" error={e.intervalKm?.message}>
              <AdornedInput trailing="km" {...fieldA11y('s-km', e.intervalKm?.message)} inputMode="numeric" placeholder="10.000" {...register('intervalKm')} />
            </Field>
            <Field label="Ou a cada (meses)" htmlFor="s-months" error={e.intervalMonths?.message}>
              <AdornedInput trailing="meses" className="pr-16" {...fieldA11y('s-months', e.intervalMonths?.message)} inputMode="numeric" placeholder="12" {...register('intervalMonths')} />
            </Field>
          </div>
        </details>

        <Field label="Descrição" htmlFor="s-description" error={e.description?.message}>
          <Textarea id="s-description" rows={2} placeholder="O que está incluído. Aparece no orçamento." {...register('description')} />
        </Field>

        {service && (
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" {...register('isActive')} />
            <span>
              Serviço ativo
              <span className="block text-xs text-muted">Inativo não aparece para novos orçamentos, mas continua nos antigos.</span>
            </span>
          </label>
        )}
      </div>
      <DialogFooter>
        {service && (
          <Button variant="ghost" className="sm:mr-auto" onClick={() => setConfirmDelete(true)}>
            <Trash2 />
            Excluir
          </Button>
        )}
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {service ? 'Salvar' : 'Cadastrar serviço'}
        </Button>
      </DialogFooter>

      {service && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          destructive
          title={`Excluir ${service.name}?`}
          description="O serviço sai do catálogo. Orçamentos e ordens que já usaram este serviço não mudam. Para só esconder dos novos orçamentos, desmarque “Serviço ativo”."
          confirmLabel="Excluir"
          onConfirm={async () => {
            try {
              await remove.mutateAsync(service.id);
              toast.success(`${service.name} foi excluído.`);
              onDone();
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        />
      )}
    </form>
  );
}
