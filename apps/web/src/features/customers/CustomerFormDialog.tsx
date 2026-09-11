import { zodResolver } from '@hookform/resolvers/zod';
import {
  BRAZIL_STATES,
  CUSTOMER_SOURCE_LABELS,
  CUSTOMER_SOURCES,
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPES,
  customerFormSchema,
  formatBrazilianPhone,
  formatDocument,
  type Customer,
  type CustomerForm,
} from '@oficinaos/shared';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input, Textarea } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useSaveCustomer } from './api';

const emptyAddress = { zip: '', street: '', number: '', complement: '', district: '', city: '', state: '' };

function toFormValues(customer?: Customer): CustomerForm {
  return {
    type: customer?.type ?? 'PF',
    name: customer?.name ?? '',
    document: customer?.document ? formatDocument(customer.document) : '',
    whatsapp: customer?.whatsapp ? formatBrazilianPhone(customer.whatsapp) : '',
    phone: customer?.phone ? formatBrazilianPhone(customer.phone) : '',
    email: customer?.email ?? '',
    address: customer
      ? { ...customer.address, zip: customer.address.zip.replace(/^(\d{5})(\d{3})$/, '$1-$2') }
      : emptyAddress,
    notes: customer?.notes ?? '',
    source: customer?.source ?? '',
    marketingOptIn: customer?.marketingOptIn ?? false,
  };
}

/** Cadastro e edição de cliente. O mínimo é o nome; o resto ajuda, mas não trava o balcão. */
export function CustomerFormDialog({ open, onOpenChange, customer, onSaved }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  customer?: Customer;
  onSaved?(customer: Customer): void;
}) {
  const save = useSaveCustomer();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(customerFormSchema), defaultValues: toFormValues(customer) });

  // Reinicia SÓ ao abrir: o `customer` muda de identidade a cada nova busca da consulta
  // (ao voltar para a aba, por exemplo) e reiniciar ali apagaria a edição em andamento.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) reset(toFormValues(customer));
    wasOpen.current = open;
  }, [open, customer, reset]);

  const type = watch('type');
  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync({ id: customer?.id, body: values });
      toast.success(customer ? 'Cliente atualizado.' : `${saved.name} cadastrado.`);
      onOpenChange(false);
      onSaved?.(saved);
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
            title={customer ? 'Editar cliente' : 'Novo cliente'}
            description={customer ? undefined : 'Só o nome é obrigatório. O WhatsApp é o que permite mandar orçamento e aviso de carro pronto.'}
          />
          <div className="space-y-4">
            {e.root?.message && <Alert variant="danger">{e.root.message}</Alert>}
            <div role="radiogroup" aria-label="Tipo de cliente" className="inline-flex rounded-lg border border-border p-0.5">
              {CUSTOMER_TYPES.map((option) => (
                <label
                  key={option}
                  className={cn(
                    'cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-bright',
                    type === option ? 'bg-surface-muted font-medium text-foreground' : 'text-muted hover:text-foreground',
                  )}
                >
                  <input type="radio" value={option} className="sr-only" {...register('type')} />
                  {CUSTOMER_TYPE_LABELS[option]}
                </label>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={type === 'PJ' ? 'Nome da empresa' : 'Nome'} htmlFor="c-name" error={e.name?.message} className="sm:col-span-2">
                <Input {...fieldA11y('c-name', e.name?.message)} autoFocus autoComplete="off" {...register('name')} />
              </Field>
              <Field label="WhatsApp" htmlFor="c-whatsapp" error={e.whatsapp?.message}>
                <Input {...fieldA11y('c-whatsapp', e.whatsapp?.message)} type="tel" inputMode="tel" placeholder="(11) 98765-4321" {...register('whatsapp')} />
              </Field>
              <Field label="Outro telefone" htmlFor="c-phone" error={e.phone?.message}>
                <Input {...fieldA11y('c-phone', e.phone?.message)} type="tel" inputMode="tel" {...register('phone')} />
              </Field>
              <Field label={type === 'PJ' ? 'CNPJ' : 'CPF'} htmlFor="c-document" error={e.document?.message}>
                <Input
                  {...fieldA11y('c-document', e.document?.message)}
                  placeholder={type === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
                  {...register('document')}
                />
              </Field>
              <Field label="E-mail" htmlFor="c-email" error={e.email?.message}>
                <Input {...fieldA11y('c-email', e.email?.message)} type="email" inputMode="email" {...register('email')} />
              </Field>
            </div>

            <details className="group rounded-lg border border-border" open={Boolean(customer?.address.street)}>
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium select-none marker:hidden">
                Endereço <span className="font-normal text-muted">(opcional)</span>
              </summary>
              <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-6">
                <Field label="CEP" htmlFor="c-zip" error={e.address?.zip?.message} className="sm:col-span-2">
                  <Input {...fieldA11y('c-zip', e.address?.zip?.message)} inputMode="numeric" placeholder="00000-000" {...register('address.zip')} />
                </Field>
                <Field label="Rua" htmlFor="c-street" className="sm:col-span-4">
                  <Input id="c-street" {...register('address.street')} />
                </Field>
                <Field label="Número" htmlFor="c-number" className="sm:col-span-2">
                  <Input id="c-number" {...register('address.number')} />
                </Field>
                <Field label="Complemento" htmlFor="c-complement" className="sm:col-span-4">
                  <Input id="c-complement" {...register('address.complement')} />
                </Field>
                <Field label="Bairro" htmlFor="c-district" className="sm:col-span-2">
                  <Input id="c-district" {...register('address.district')} />
                </Field>
                <Field label="Cidade" htmlFor="c-city" className="sm:col-span-3">
                  <Input id="c-city" {...register('address.city')} />
                </Field>
                <Field label="UF" htmlFor="c-state" error={e.address?.state?.message} className="sm:col-span-1">
                  <Select id="c-state" {...register('address.state')}>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Como conheceu a oficina" htmlFor="c-source">
                <Select id="c-source" {...register('source')}>
                  <option value="">Não informado</option>
                  {CUSTOMER_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {CUSTOMER_SOURCE_LABELS[source]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Observações" htmlFor="c-notes" error={e.notes?.message} className="sm:col-span-2">
                <Textarea id="c-notes" rows={2} placeholder="Ex.: prefere ligação depois das 18h" {...register('notes')} />
              </Field>
            </div>

            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" {...register('marketingOptIn')} />
              <span>
                Aceita receber lembretes de revisão e novidades da oficina pelo WhatsApp
                <span className="block text-xs text-muted">Pergunte ao cliente. Sem esse aceite, a oficina só manda mensagens do serviço em andamento (LGPD).</span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {customer ? 'Salvar' : 'Cadastrar cliente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
