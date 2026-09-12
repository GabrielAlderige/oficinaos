import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatBRLInput,
  formatPercentInput,
  partCategoryInputSchema,
  pricingSettingsFormSchema,
  type OrganizationSettings,
  type PartCategory,
  type PricingSettingsForm,
} from '@oficinaos/shared';
import { Pencil } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Input } from '../../components/ui/input';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useCreateCategory, usePartCategories, useRenameCategory } from '../catalog/api';
import { useOrganizationSettings, useUpdateOrganizationSettings } from './api';

function toFormValues(settings: OrganizationSettings): PricingSettingsForm {
  return {
    laborRate: settings.laborRateCents !== null ? formatBRLInput(settings.laborRateCents) : '',
    defaultMarkup: formatPercentInput(settings.defaultMarkupBps),
  };
}

export function PricingSettingsPage() {
  const settings = useOrganizationSettings();
  return (
    <div className="space-y-6">
      {settings.isPending ? (
        <Card className="space-y-4 p-6" aria-label="Carregando preços">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </Card>
      ) : settings.isError ? (
        <Alert variant="danger">{errorMessage(settings.error)}</Alert>
      ) : (
        <PricingForm settings={settings.data} />
      )}
      <CategoriesCard />
    </div>
  );
}

function PricingForm({ settings }: { settings: OrganizationSettings }) {
  const canEdit = useCan('organization:manage');
  const update = useUpdateOrganizationSettings();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors: e, isDirty, isSubmitting },
  } = useForm({ resolver: zodResolver(pricingSettingsFormSchema), defaultValues: toFormValues(settings) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values);
      reset(toFormValues(saved));
      toast.success('Preços salvos.');
    } catch (err) {
      if (!applyFieldErrors(err, setError, { laborRateCents: 'laborRate', defaultMarkupBps: 'defaultMarkup' })) {
        toast.error(errorMessage(err));
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      {!canEdit && (
        <Alert variant="info" className="mb-4">
          Só o dono ou um administrador altera estes valores.
        </Alert>
      )}
      <Card>
        <fieldset disabled={!canEdit} className="contents">
          <section className="grid gap-4 px-5 py-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 md:px-6">
            <div>
              <h2 className="text-sm font-semibold">Preços</h2>
              <p className="mt-1 text-sm text-muted">Base de cálculo dos serviços por hora e do preço sugerido das peças.</p>
            </div>
            <div className="grid content-start gap-4 sm:grid-cols-2">
              <Field
                label="Valor da hora técnica"
                htmlFor="laborRate"
                error={e.laborRate?.message}
                hint="Serviço por hora = valor da hora × tempo padrão."
              >
                <AdornedInput leading="R$" {...fieldA11y('laborRate', e.laborRate?.message, true)} inputMode="decimal" placeholder="0,00" {...register('laborRate')} />
              </Field>
              <Field
                label="Margem padrão das peças"
                htmlFor="defaultMarkup"
                error={e.defaultMarkup?.message}
                hint="Preço sugerido = custo + margem. Cada peça pode ter a própria."
              >
                <AdornedInput trailing="%" {...fieldA11y('defaultMarkup', e.defaultMarkup?.message, true)} inputMode="decimal" {...register('defaultMarkup')} />
              </Field>
            </div>
          </section>
        </fieldset>
        {canEdit && (
          <div className="flex items-center justify-end gap-2 rounded-b-xl border-t border-border px-5 py-3 md:px-6">
            {isDirty && <span className="mr-auto text-xs text-muted">Alterações não salvas</span>}
            <Button variant="secondary" disabled={!isDirty || isSubmitting} onClick={() => reset()}>
              Descartar
            </Button>
            <Button type="submit" disabled={!isDirty} loading={isSubmitting}>
              Salvar
            </Button>
          </div>
        )}
      </Card>
    </form>
  );
}

function CategoriesCard() {
  const canWrite = useCan('catalog:write');
  const categories = usePartCategories();
  const create = useCreateCategory();
  return (
    <Card>
      <CardHeader title="Categorias de peças" description="Organizam o catálogo e o filtro da lista de peças." />
      {categories.isPending ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : categories.isError ? (
        <div className="p-5">
          <Alert variant="danger">{errorMessage(categories.error)}</Alert>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {categories.data.map((category) => (
            <CategoryRow key={category.id} category={category} canWrite={canWrite} />
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="border-t border-border px-5 py-3">
          <CategoryNameForm
            initial=""
            label="Nova categoria"
            submitLabel="Adicionar"
            onSubmit={async (name) => {
              await create.mutateAsync(name);
              toast.success(`Categoria ${name} criada.`);
            }}
          />
        </div>
      )}
    </Card>
  );
}

function CategoryRow({ category, canWrite }: { category: PartCategory; canWrite: boolean }) {
  const rename = useRenameCategory();
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="px-5 py-2.5">
        <CategoryNameForm
          initial={category.name}
          label={`Novo nome para ${category.name}`}
          submitLabel="Salvar"
          onCancel={() => setEditing(false)}
          onSubmit={async (name) => {
            await rename.mutateAsync({ id: category.id, name });
            setEditing(false);
          }}
        />
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 px-5 py-2">
      <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
      <span className="text-xs text-muted tabular">
        {category.partCount} {category.partCount === 1 ? 'peça' : 'peças'}
      </span>
      {canWrite && (
        <Button variant="ghost" size="icon" className="size-8" aria-label={`Renomear ${category.name}`} onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
      )}
    </li>
  );
}

function CategoryNameForm({ initial, label, submitLabel, onSubmit, onCancel }: {
  initial: string;
  label: string;
  submitLabel: string;
  onSubmit(name: string): Promise<void>;
  onCancel?(): void;
}) {
  const id = useId();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(partCategoryInputSchema), defaultValues: { name: initial } });

  const submit = handleSubmit(async ({ name }) => {
    try {
      await onSubmit(name);
      if (!onCancel) reset({ name: '' });
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setError('name', { message: errorMessage(err) });
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-2">
      <div className="min-w-48 flex-1">
        <Input
          {...fieldA11y(id, errors.name?.message)}
          aria-label={label}
          placeholder={label}
          autoFocus={Boolean(onCancel)}
          autoComplete="off"
          {...register('name')}
        />
        {errors.name?.message && (
          <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">
            {errors.name.message}
          </p>
        )}
      </div>
      <Button type="submit" variant="secondary" loading={isSubmitting}>
        {submitLabel}
      </Button>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      )}
    </form>
  );
}
