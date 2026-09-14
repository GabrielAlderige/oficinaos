import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatBRL,
  formatBRLInput,
  formatPercentInput,
  PART_UNIT_LABELS,
  PART_UNITS,
  parseBRL,
  parsePercent,
  partFormSchema,
  suggestedSalePrice,
  type Part,
  type PartForm,
  type PartInput,
} from '@oficinaos/shared';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useOrganizationSettings } from '../settings/api';
import { usePartCategories, useSavePart } from './api';
import { useSuppliers } from '../suppliers/api';
import { quantityInput } from './stock';

function toFormValues(part?: Part): PartForm {
  return {
    name: part?.name ?? '',
    sku: part?.sku ?? '',
    manufacturerCode: part?.manufacturerCode ?? '',
    manufacturer: part?.manufacturer ?? '',
    categoryId: part?.category?.id ?? '',
    description: part?.description ?? '',
    unit: part?.unit ?? 'UN',
    ean: part?.ean ?? '',
    salePrice: part?.salePriceCents != null ? formatBRLInput(part.salePriceCents) : '',
    markup: part?.markupBps != null ? formatPercentInput(part.markupBps) : '',
    minQuantity: quantityInput(part?.minQuantity ?? null),
    location: part?.location ?? '',
    preferredSupplierId: part?.preferredSupplier?.id ?? '',
    trackStock: part?.trackStock ?? true,
    isActive: part?.isActive ?? true,
    initialQuantity: '',
    initialUnitCost: '',
  };
}

const API_TO_FORM = { salePriceCents: 'salePrice', markupBps: 'markup', initialUnitCostCents: 'initialUnitCost' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

export function PartFormDialog({ open, onOpenChange, part, onSaved }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  part?: Part;
  onSaved?(part: Part): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <PartFormBody
          part={part}
          onDone={(saved) => {
            onOpenChange(false);
            if (saved) onSaved?.(saved);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PartFormBody({ part, onDone }: { part?: Part; onDone(saved?: Part): void }) {
  const save = useSavePart();
  const categories = usePartCategories();
  const settings = useOrganizationSettings();
  const canSeeCost = useCan('parts:view_cost') && !part?.costHidden;
  const podeVerFornecedor = useCan('suppliers:read');
  const fornecedores = useSuppliers({ q: '', page: 1, pageSize: 100 }, { enabled: podeVerFornecedor });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors: e, isSubmitting },
  } = useForm({ resolver: zodResolver(partFormSchema), defaultValues: toFormValues(part) });

  const trackStock = watch('trackStock');
  const unit = watch('unit');
  const defaultMarkup = settings.data?.defaultMarkupBps ?? null;

  // preço sugerido = custo × (1 + margem): o custo vem das entradas (edição) ou do cadastro inicial
  const cost = part ? (part.averageCostCents ?? part.lastCostCents) : parseBRL(watch('initialUnitCost') || 'x');
  const markupBps = parsePercent(watch('markup') || 'x') ?? defaultMarkup;
  const suggested = canSeeCost && cost !== null && markupBps !== null ? suggestedSalePrice(cost, markupBps) : null;

  const onSubmit = handleSubmit(async (values) => {
    const body: Partial<PartInput> = { ...values };
    if (part) {
      // custo e estoque inicial só existem no cadastro; depois vêm das entradas
      delete body.initialQuantity;
      delete body.initialUnitCostCents;
    }
    // quem não vê fornecedor não tem o campo na tela: mandar null apagaria o preferido sem saber
    if (!podeVerFornecedor) delete body.preferredSupplierId;
    try {
      const saved = await save.mutateAsync({ id: part?.id, body });
      toast.success(part ? 'Peça atualizada.' : `${saved.name} cadastrada.`);
      onDone(saved);
    } catch (err) {
      if (!applyFieldErrors(err, setError, API_TO_FORM)) setError('root', { message: errorMessage(err) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader
        title={part ? 'Editar peça' : 'Nova peça'}
        description={part ? undefined : 'Só o nome é obrigatório. O código do fabricante é o que se pede no balcão do fornecedor.'}
      />
      <div className="space-y-6">
        {e.root?.message && <Alert variant="danger">{e.root.message}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome da peça" htmlFor="p-name" error={e.name?.message} className="sm:col-span-2">
            <Input {...fieldA11y('p-name', e.name?.message)} autoFocus autoComplete="off" placeholder="Ex.: Pastilha de freio dianteira" {...register('name')} />
          </Field>
          <Field label="Marca" htmlFor="p-manufacturer" error={e.manufacturer?.message}>
            <Input {...fieldA11y('p-manufacturer', e.manufacturer?.message)} placeholder="Ex.: Cobreq" {...register('manufacturer')} />
          </Field>
          <Field label="Código do fabricante" htmlFor="p-mcode" error={e.manufacturerCode?.message}>
            <Input {...fieldA11y('p-mcode', e.manufacturerCode?.message)} autoComplete="off" placeholder="Ex.: N-1234" {...register('manufacturerCode')} />
          </Field>
          <Field label="Categoria" htmlFor="p-category" error={e.categoryId?.message}>
            <Select {...fieldA11y('p-category', e.categoryId?.message)} {...register('categoryId')}>
              <option value="">Sem categoria</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Código interno" htmlFor="p-sku" error={e.sku?.message} hint="O da etiqueta da prateleira, se a oficina usa.">
            <Input {...fieldA11y('p-sku', e.sku?.message, true)} autoComplete="off" {...register('sku')} />
          </Field>
          <Field label="Unidade" htmlFor="p-unit" error={e.unit?.message}>
            <Select {...fieldA11y('p-unit', e.unit?.message)} {...register('unit')}>
              {PART_UNITS.map((u) => (
                <option key={u} value={u}>
                  {PART_UNIT_LABELS[u]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Localização" htmlFor="p-location" error={e.location?.message}>
            <Input {...fieldA11y('p-location', e.location?.message)} placeholder="Ex.: prateleira B3" {...register('location')} />
          </Field>
          {podeVerFornecedor && (
            <Field
              label="Fornecedor preferido"
              htmlFor="p-supplier"
              error={e.preferredSupplierId?.message}
              hint="De quem a oficina costuma comprar. A cotação começa por ele."
              className="sm:col-span-2"
            >
              <Select {...fieldA11y('p-supplier', e.preferredSupplierId?.message, true)} {...register('preferredSupplierId')}>
                <option value="">Nenhum</option>
                {/* o preferido atual entra mesmo que não esteja entre os 100 primeiros da lista */}
                {part?.preferredSupplier &&
                  !fornecedores.data?.data.some((f) => f.id === part.preferredSupplier!.id) && (
                    <option value={part.preferredSupplier.id}>{part.preferredSupplier.name}</option>
                  )}
                {fornecedores.data?.data.map((fornecedor) => (
                  <option key={fornecedor.id} value={fornecedor.id}>
                    {fornecedor.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <Section title="Preço">
          <Field
            label="Preço de venda"
            htmlFor="p-price"
            error={e.salePrice?.message}
            hint={
              suggested !== null && (
                <>
                  Sugerido pela margem: {formatBRL(suggested)}{' '}
                  <button
                    type="button"
                    className="font-medium text-accent underline-offset-2 hover:underline dark:text-accent-bright"
                    onClick={() => setValue('salePrice', formatBRLInput(suggested), { shouldDirty: true, shouldValidate: true })}
                  >
                    Usar
                  </button>
                </>
              )
            }
          >
            <AdornedInput leading="R$" {...fieldA11y('p-price', e.salePrice?.message, suggested !== null)} inputMode="decimal" placeholder="0,00" {...register('salePrice')} />
          </Field>
          {canSeeCost && (
            <Field
              label="Margem própria"
              htmlFor="p-markup"
              error={e.markup?.message}
              hint={defaultMarkup !== null ? `Vazio = margem padrão da oficina (${formatPercentInput(defaultMarkup)}%).` : undefined}
            >
              <AdornedInput trailing="%" {...fieldA11y('p-markup', e.markup?.message, true)} inputMode="decimal" placeholder={defaultMarkup !== null ? formatPercentInput(defaultMarkup) : ''} {...register('markup')} />
            </Field>
          )}
        </Section>

        <Section title="Estoque">
          <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 size-4" {...register('trackStock')} />
            <span>
              Controlar estoque desta peça
              <span className="block text-xs text-muted">Desmarque para peças compradas só sob encomenda, que não ficam na prateleira.</span>
            </span>
          </label>
          {trackStock && (
            <>
              {!part && (
                <Field label="Quantidade na prateleira hoje" htmlFor="p-initial" error={e.initialQuantity?.message} hint="Vira o primeiro movimento do estoque.">
                  <AdornedInput trailing={unit === 'UN' ? 'un' : unit} {...fieldA11y('p-initial', e.initialQuantity?.message, true)} inputMode="decimal" placeholder="0" {...register('initialQuantity')} />
                </Field>
              )}
              {!part && canSeeCost && (
                <Field label="Custo unitário" htmlFor="p-cost" error={e.initialUnitCost?.message} hint="Quanto a oficina pagou. Base do custo médio.">
                  <AdornedInput leading="R$" {...fieldA11y('p-cost', e.initialUnitCost?.message, true)} inputMode="decimal" placeholder="0,00" {...register('initialUnitCost')} />
                </Field>
              )}
              <Field label="Estoque mínimo" htmlFor="p-min" error={e.minQuantity?.message} hint="Abaixo disso, a peça aparece nos alertas.">
                <AdornedInput trailing={unit === 'UN' ? 'un' : unit} {...fieldA11y('p-min', e.minQuantity?.message, true)} inputMode="decimal" placeholder="0" {...register('minQuantity')} />
              </Field>
            </>
          )}
        </Section>

        <details className="rounded-lg border border-border" open={Boolean(part?.ean || part?.description)}>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium select-none marker:hidden">
            Mais detalhes <span className="font-normal text-muted">(opcional)</span>
          </summary>
          <div className="grid gap-4 border-t border-border p-3">
            <Field label="Código de barras (EAN)" htmlFor="p-ean" error={e.ean?.message}>
              <Input {...fieldA11y('p-ean', e.ean?.message)} inputMode="numeric" {...register('ean')} />
            </Field>
            <Field label="Descrição" htmlFor="p-description" error={e.description?.message}>
              <Textarea id="p-description" rows={2} {...register('description')} />
            </Field>
          </div>
        </details>

        {part && (
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" {...register('isActive')} />
            <span>
              Peça ativa
              <span className="block text-xs text-muted">Inativa sai das buscas do orçamento, mas o histórico continua.</span>
            </span>
          </label>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onDone()}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {part ? 'Salvar' : 'Cadastrar peça'}
        </Button>
      </DialogFooter>
    </form>
  );
}
