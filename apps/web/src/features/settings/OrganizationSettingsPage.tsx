import { zodResolver } from '@hookform/resolvers/zod';
import {
  BRAZIL_STATES,
  BRAZIL_TIMEZONES,
  formatBrazilianPhone,
  formatDocument,
  organizationFormSchema,
  type BrazilTimezone,
  type Organization,
  type OrganizationForm,
} from '@oficinaos/shared';
import type { ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useOrganization, useUpdateOrganization } from './api';
import { BusinessHoursEditor } from './BusinessHoursEditor';

function toFormValues(org: Organization): OrganizationForm {
  return {
    name: org.name,
    legalName: org.legalName ?? '',
    document: org.document ? formatDocument(org.document) : '',
    phone: org.phone ? formatBrazilianPhone(org.phone) : '',
    whatsapp: org.whatsapp ? formatBrazilianPhone(org.whatsapp) : '',
    email: org.email ?? '',
    address: { ...org.address, zip: org.address.zip.replace(/^(\d{5})(\d{3})$/, '$1-$2') },
    timezone: (org.timezone in BRAZIL_TIMEZONES ? org.timezone : 'America/Sao_Paulo') as BrazilTimezone,
    businessHours: org.businessHours,
  };
}

/** Primeira mensagem de erro dentro de um grupo (ex.: businessHours.mon.0). */
function firstMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { message } = error as { message?: unknown };
  if (typeof message === 'string' && message) return message;
  for (const [key, value] of Object.entries(error)) {
    if (key === 'ref' || key === 'type') continue;
    const found = firstMessage(value);
    if (found) return found;
  }
  return undefined;
}

export function OrganizationSettingsPage() {
  const organization = useOrganization();
  if (organization.isPending) {
    return (
      <Card className="space-y-4 p-6" aria-label="Carregando dados da oficina">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </Card>
    );
  }
  if (organization.isError) return <Alert variant="danger">{errorMessage(organization.error)}</Alert>;
  return <OrganizationFormCard organization={organization.data} />;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-border px-5 py-6 last:border-b-0 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 md:px-6">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="grid content-start gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function OrganizationFormCard({ organization }: { organization: Organization }) {
  const canEdit = useCan('organization:manage');
  const update = useUpdateOrganization();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({ resolver: zodResolver(organizationFormSchema), defaultValues: toFormValues(organization) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values);
      reset(toFormValues(saved));
      toast.success('Dados da oficina salvos.');
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(errorMessage(err));
    }
  });

  const e = errors;
  return (
    <form onSubmit={onSubmit} noValidate>
      {!canEdit && (
        <Alert variant="info" className="mb-4">
          Só o dono ou um administrador altera estes dados.
        </Alert>
      )}
      <Card>
        <fieldset disabled={!canEdit} className="contents">
          <Section title="Identificação" description="Como a oficina aparece para os clientes.">
            <Field label="Nome da oficina" htmlFor="name" error={e.name?.message} className="sm:col-span-2">
              <Input {...fieldA11y('name', e.name?.message)} {...register('name')} />
            </Field>
            <Field label="Razão social" htmlFor="legalName" error={e.legalName?.message}>
              <Input {...fieldA11y('legalName', e.legalName?.message)} {...register('legalName')} />
            </Field>
            <Field label="CNPJ ou CPF" htmlFor="document" error={e.document?.message}>
              <Input {...fieldA11y('document', e.document?.message)} placeholder="00.000.000/0000-00" {...register('document')} />
            </Field>
          </Section>

          <Section title="Contato">
            <Field label="Telefone" htmlFor="phone" error={e.phone?.message}>
              <Input {...fieldA11y('phone', e.phone?.message)} type="tel" inputMode="tel" placeholder="(11) 3456-7890" {...register('phone')} />
            </Field>
            <Field label="WhatsApp" htmlFor="whatsapp" error={e.whatsapp?.message}>
              <Input {...fieldA11y('whatsapp', e.whatsapp?.message)} type="tel" inputMode="tel" placeholder="(11) 98765-4321" {...register('whatsapp')} />
            </Field>
            <Field label="E-mail" htmlFor="email" error={e.email?.message} className="sm:col-span-2">
              <Input {...fieldA11y('email', e.email?.message)} type="email" inputMode="email" {...register('email')} />
            </Field>
          </Section>

          <Section title="Endereço">
            <Field label="CEP" htmlFor="zip" error={e.address?.zip?.message}>
              <Input {...fieldA11y('zip', e.address?.zip?.message)} inputMode="numeric" placeholder="00000-000" {...register('address.zip')} />
            </Field>
            <Field label="Número" htmlFor="number" error={e.address?.number?.message}>
              <Input {...fieldA11y('number', e.address?.number?.message)} {...register('address.number')} />
            </Field>
            <Field label="Rua" htmlFor="street" error={e.address?.street?.message} className="sm:col-span-2">
              <Input {...fieldA11y('street', e.address?.street?.message)} {...register('address.street')} />
            </Field>
            <Field label="Complemento" htmlFor="complement" error={e.address?.complement?.message}>
              <Input {...fieldA11y('complement', e.address?.complement?.message)} {...register('address.complement')} />
            </Field>
            <Field label="Bairro" htmlFor="district" error={e.address?.district?.message}>
              <Input {...fieldA11y('district', e.address?.district?.message)} {...register('address.district')} />
            </Field>
            <Field label="Cidade" htmlFor="city" error={e.address?.city?.message}>
              <Input {...fieldA11y('city', e.address?.city?.message)} {...register('address.city')} />
            </Field>
            <Field label="UF" htmlFor="state" error={e.address?.state?.message}>
              <Select {...fieldA11y('state', e.address?.state?.message)} {...register('address.state')}>
                <option value="">Selecione</option>
                {BRAZIL_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>

          <Section title="Funcionamento" description="Dias e horários em que a oficina atende.">
            <Field label="Fuso horário" htmlFor="timezone" error={e.timezone?.message} className="sm:col-span-2">
              <Select {...fieldA11y('timezone', e.timezone?.message)} {...register('timezone')}>
                {Object.entries(BRAZIL_TIMEZONES).map(([tz, label]) => (
                  <option key={tz} value={tz}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-1.5 sm:col-span-2">
              <span className="text-[13px] font-medium">Horário de atendimento</span>
              <Controller
                control={control}
                name="businessHours"
                render={({ field }) => (
                  <BusinessHoursEditor value={field.value} onChange={field.onChange} disabled={!canEdit} />
                )}
              />
              {firstMessage(e.businessHours) && (
                <p role="alert" className="text-xs text-danger">
                  {firstMessage(e.businessHours)}
                </p>
              )}
            </div>
          </Section>
        </fieldset>

        {canEdit && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 rounded-b-xl border-t border-border bg-surface/95 px-5 py-3 backdrop-blur md:px-6">
            {isDirty && <span className="mr-auto text-xs text-muted">Alterações não salvas</span>}
            <Button variant="secondary" disabled={!isDirty || isSubmitting} onClick={() => reset()}>
              Descartar
            </Button>
            <Button type="submit" disabled={!isDirty} loading={isSubmitting}>
              Salvar alterações
            </Button>
          </div>
        )}
      </Card>
    </form>
  );
}
