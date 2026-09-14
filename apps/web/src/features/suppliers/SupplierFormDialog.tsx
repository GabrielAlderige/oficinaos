import { zodResolver } from '@hookform/resolvers/zod';
import {
  BRAZIL_STATES,
  formatBrazilianPhone,
  formatDocument,
  supplierTextFormSchema,
  type Supplier,
  type SupplierTextForm,
} from '@oficinaos/shared';
import { Plus, Star, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { usePartCategories } from '../catalog/api';
import { useSaveSupplier } from './api';

const enderecoVazio = { zip: '', street: '', number: '', complement: '', district: '', city: '', state: '' };

function valoresIniciais(fornecedor?: Supplier): SupplierTextForm {
  return {
    name: fornecedor?.name ?? '',
    legalName: fornecedor?.legalName ?? '',
    document: fornecedor?.document ? formatDocument(fornecedor.document) : '',
    contactName: fornecedor?.contactName ?? '',
    whatsapp: fornecedor?.whatsapp ? formatBrazilianPhone(fornecedor.whatsapp) : '',
    phone: fornecedor?.phone ? formatBrazilianPhone(fornecedor.phone) : '',
    email: fornecedor?.email ?? '',
    address: fornecedor
      ? { ...fornecedor.address, zip: fornecedor.address.zip.replace(/^(\d{5})(\d{3})$/, '$1-$2') }
      : enderecoVazio,
    categories: fornecedor?.categories ?? [],
    leadTimeDays: fornecedor?.leadTimeDays === null || fornecedor?.leadTimeDays === undefined ? '' : String(fornecedor.leadTimeDays),
    rating: fornecedor?.rating ? (String(fornecedor.rating) as SupplierTextForm['rating']) : '',
    notes: fornecedor?.notes ?? '',
  };
}

/**
 * Categorias como etiquetas. As sugestões vêm das categorias de peça da própria
 * oficina: "Freios" no fornecedor e "Freios" na peça é o que vai deixar a E11
 * sugerir sozinha quem cotar. Mas a pessoa pode escrever outra à vontade.
 */
function CampoCategorias({ valor, onChange }: { valor: string[]; onChange(valor: string[]): void }) {
  const [digitando, setDigitando] = useState('');
  const categoriasDePeca = usePartCategories();
  const sugestoes = (categoriasDePeca.data ?? [])
    .map((categoria) => categoria.name)
    .filter((nome) => !valor.some((atual) => atual.toLowerCase() === nome.toLowerCase()));

  const adicionar = (texto: string) => {
    const limpo = texto.trim();
    if (!limpo || valor.some((atual) => atual.toLowerCase() === limpo.toLowerCase())) return;
    onChange([...valor, limpo]);
    setDigitando('');
  };

  const teclas = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      adicionar(digitando);
    }
    // apagar com o campo vazio tira a última etiqueta, como em qualquer campo de tags
    if (event.key === 'Backspace' && !digitando && valor.length) onChange(valor.slice(0, -1));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 focus-within:border-accent-bright">
        {valor.map((categoria) => (
          <span key={categoria} className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-sm">
            {categoria}
            <button
              type="button"
              onClick={() => onChange(valor.filter((atual) => atual !== categoria))}
              className="rounded text-muted hover:text-foreground"
              aria-label={`Tirar a categoria ${categoria}`}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id="s-categories"
          value={digitando}
          onChange={(event) => setDigitando(event.target.value)}
          onKeyDown={teclas}
          onBlur={() => adicionar(digitando)}
          placeholder={valor.length ? '' : 'Digite e aperte Enter'}
          className="min-w-32 flex-1 bg-transparent py-0.5 text-sm outline-none"
        />
      </div>
      {sugestoes.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Sugestões das categorias de peça">
          {sugestoes.slice(0, 11).map((nome) => (
            <button
              key={nome}
              type="button"
              onClick={() => adicionar(nome)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted hover:border-accent-bright hover:text-foreground"
            >
              <Plus className="size-3" aria-hidden="true" />
              {nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Nota de 1 a 5 com estrelas, que é como a oficina pensa num fornecedor. */
function CampoNota({ valor, onChange }: { valor: SupplierTextForm['rating']; onChange(valor: SupplierTextForm['rating']): void }) {
  const atual = Number(valor || 0);
  return (
    <div role="radiogroup" aria-label="Nota do fornecedor" className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((nota) => (
        <button
          key={nota}
          type="button"
          role="radio"
          aria-checked={atual === nota}
          aria-label={`${nota} de 5`}
          // clicar de novo na mesma estrela limpa a nota
          onClick={() => onChange(atual === nota ? '' : (String(nota) as SupplierTextForm['rating']))}
          className="rounded p-0.5"
        >
          <Star className={cn('size-5', nota <= atual ? 'fill-warning text-warning' : 'text-border')} />
        </button>
      ))}
      {atual > 0 && <span className="ml-1.5 text-sm text-muted">{atual} de 5</span>}
    </div>
  );
}

/** Cadastro e edição. Só o nome é obrigatório; o WhatsApp é o que a cotação por link vai usar. */
export function SupplierFormDialog({ open, onOpenChange, supplier, onSaved }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  supplier?: Supplier;
  onSaved?(supplier: Supplier): void;
}) {
  const save = useSaveSupplier();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(supplierTextFormSchema), defaultValues: valoresIniciais(supplier) });

  // reinicia SÓ ao abrir: a consulta rebusca (ao voltar para a aba) e apagaria a edição em andamento
  const estavaAberto = useRef(false);
  useEffect(() => {
    if (open && !estavaAberto.current) reset(valoresIniciais(supplier));
    estavaAberto.current = open;
  }, [open, supplier, reset]);

  const onSubmit = handleSubmit(async (valores) => {
    try {
      const salvo = await save.mutateAsync({ id: supplier?.id, body: valores });
      toast.success(supplier ? 'Fornecedor atualizado.' : `${salvo.name} cadastrado.`);
      onOpenChange(false);
      onSaved?.(salvo);
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setError('root', { message: errorMessage(err) });
    }
  });

  const e = errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader
            title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'}
            description={
              supplier ? undefined : 'Só o nome é obrigatório. Com o WhatsApp, a cotação por link chega direto no celular dele.'
            }
          />
          <div className="space-y-4">
            {e.root?.message && <Alert variant="danger">{e.root.message}</Alert>}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" htmlFor="s-name" error={e.name?.message} hint="Como a oficina chama: “Central Autopeças”">
                <Input {...fieldA11y('s-name', e.name?.message, true)} autoFocus autoComplete="off" {...register('name')} />
              </Field>
              <Field label="Vendedor" htmlFor="s-contact" error={e.contactName?.message}>
                <Input {...fieldA11y('s-contact', e.contactName?.message)} placeholder="Com quem se fala" {...register('contactName')} />
              </Field>
              <Field label="WhatsApp" htmlFor="s-whatsapp" error={e.whatsapp?.message}>
                <Input {...fieldA11y('s-whatsapp', e.whatsapp?.message)} type="tel" inputMode="tel" placeholder="(11) 98765-4321" {...register('whatsapp')} />
              </Field>
              <Field label="Outro telefone" htmlFor="s-phone" error={e.phone?.message}>
                <Input {...fieldA11y('s-phone', e.phone?.message)} type="tel" inputMode="tel" {...register('phone')} />
              </Field>
            </div>

            <Field label="Categorias" htmlFor="s-categories" error={e.categories?.message} hint="O que ele fornece. Serve para saber a quem pedir cotação.">
              <CampoCategorias valor={watch('categories')} onChange={(lista) => setValue('categories', lista, { shouldDirty: true })} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Prazo médio de entrega" htmlFor="s-lead" error={e.leadTimeDays?.message}>
                <div className="flex items-center gap-2">
                  <Input {...fieldA11y('s-lead', e.leadTimeDays?.message)} inputMode="numeric" className="w-24" {...register('leadTimeDays')} />
                  <span className="text-sm text-muted">dias</span>
                </div>
              </Field>
              <Field label="Nota da oficina" htmlFor="s-rating">
                <CampoNota valor={watch('rating')} onChange={(nota) => setValue('rating', nota, { shouldDirty: true })} />
              </Field>
            </div>

            <details className="group rounded-lg border border-border" open={Boolean(supplier?.document || supplier?.address.street)}>
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium select-none marker:hidden">
                Empresa e endereço <span className="font-normal text-muted">(opcional)</span>
              </summary>
              <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-6">
                <Field label="Razão social" htmlFor="s-legal" className="sm:col-span-4">
                  <Input id="s-legal" {...register('legalName')} />
                </Field>
                <Field label="CNPJ" htmlFor="s-document" error={e.document?.message} className="sm:col-span-2">
                  <Input {...fieldA11y('s-document', e.document?.message)} placeholder="00.000.000/0000-00" {...register('document')} />
                </Field>
                <Field label="E-mail" htmlFor="s-email" error={e.email?.message} className="sm:col-span-6">
                  <Input {...fieldA11y('s-email', e.email?.message)} type="email" inputMode="email" {...register('email')} />
                </Field>
                <Field label="CEP" htmlFor="s-zip" error={e.address?.zip?.message} className="sm:col-span-2">
                  <Input {...fieldA11y('s-zip', e.address?.zip?.message)} inputMode="numeric" placeholder="00000-000" {...register('address.zip')} />
                </Field>
                <Field label="Rua" htmlFor="s-street" className="sm:col-span-4">
                  <Input id="s-street" {...register('address.street')} />
                </Field>
                <Field label="Número" htmlFor="s-number" className="sm:col-span-2">
                  <Input id="s-number" {...register('address.number')} />
                </Field>
                <Field label="Bairro" htmlFor="s-district" className="sm:col-span-4">
                  <Input id="s-district" {...register('address.district')} />
                </Field>
                <Field label="Cidade" htmlFor="s-city" className="sm:col-span-4">
                  <Input id="s-city" {...register('address.city')} />
                </Field>
                <Field label="UF" htmlFor="s-state" className="sm:col-span-2">
                  <Select id="s-state" {...register('address.state')}>
                    <option value="">–</option>
                    {BRAZIL_STATES.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </details>

            <Field label="Observações" htmlFor="s-notes" error={e.notes?.message}>
              <Textarea id="s-notes" rows={2} placeholder="Ex.: entrega só de manhã; pedido mínimo de R$ 200" {...register('notes')} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {supplier ? 'Salvar' : 'Cadastrar fornecedor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
