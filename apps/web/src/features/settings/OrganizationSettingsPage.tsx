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
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, Skeleton } from '../../components/ui/display';
import { CepInput } from '../../components/ui/cep-input';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import {
  useOrganization,
  useOrganizationSettings,
  useUpdateOrganization,
  useUpdateOrganizationSettings,
} from './api';
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
  return (
    <div className="space-y-6">
      <OrganizationFormCard organization={organization.data} />
      <PixCard />
      <GoogleReviewCard />
      <DeliveryCard />
    </div>
  );
}

/**
 * O link de avaliação do Google. É para cá que o botão "pedir avaliação" da OS
 * manda o cliente: a nota que muda a vida da oficina é a que aparece para quem
 * procura "oficina perto de mim", não uma guardada aqui dentro.
 */
function GoogleReviewCard() {
  const canEdit = useCan('organization:manage');
  const settings = useOrganizationSettings();
  const salvar = useUpdateOrganizationSettings();
  const [url, setUrl] = useState<string | null>(null);
  const valor = url ?? settings.data?.googleReviewUrl ?? '';

  return (
    <Card>
      <div className="space-y-4 p-5 md:p-6">
        <div>
          <h2 className="text-sm font-semibold">Avaliações no Google</h2>
          <p className="mt-1 text-sm text-muted">
            Cole aqui o link de avaliação do Perfil da Empresa. É para lá que o convite manda o cliente quando você
            aperta <strong>Pedir avaliação</strong> na OS entregue.
          </p>
        </div>
        <Field
          label="Link de avaliação do Google"
          htmlFor="google-review-url"
          hint="No Google Meu Negócio: Pedir avaliações → copiar o link. Começa com https://."
        >
          <Input
            {...fieldA11y('google-review-url', undefined, true)}
            type="url"
            inputMode="url"
            placeholder="https://g.page/r/..."
            disabled={!canEdit || settings.isPending}
            value={valor}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={async () => {
              const novo = valor.trim();
              if (novo === (settings.data?.googleReviewUrl ?? '')) return;
              try {
                await salvar.mutateAsync({ googleReviewUrl: novo });
                toast.success(novo ? 'Link do Google salvo.' : 'Link do Google removido.');
              } catch (err) {
                toast.error(errorMessage(err));
                setUrl(null);
              }
            }}
          />
        </Field>
        {!settings.isPending && !valor && (
          <Alert variant="warning">
            Sem esse link, o botão <strong>Pedir avaliação</strong> da OS avisa que falta configurar.
          </Alert>
        )}
      </div>
    </Card>
  );
}

/**
 * A chave Pix da oficina (E32).
 *
 * Com ela a OS gera o QR e o copia-e-cola na hora, sem gateway: o dinheiro vai
 * direto para a conta da oficina. O preço disso é que **o banco não avisa o
 * sistema** — a baixa continua sendo no botão, e a tela diz isso aqui e lá.
 */
function PixCard() {
  const canEdit = useCan('organization:manage');
  const settings = useOrganizationSettings();
  const salvar = useUpdateOrganizationSettings();
  const [chave, setChave] = useState<string | null>(null);
  const chaveAtual = chave ?? settings.data?.pixKey ?? '';

  async function gravar(campos: { pixKey?: string }, oQue: string) {
    try {
      await salvar.mutateAsync(campos);
      toast.success(oQue);
    } catch (err) {
      toast.error(errorMessage(err));
      setChave(null);
    }
  }

  return (
    <Card>
      <div className="space-y-4 p-5 md:p-6">
        <div>
          <h2 className="text-sm font-semibold">Pix da oficina</h2>
          <p className="mt-1 text-sm text-muted">
            Cadastre a chave e a OS passa a gerar o <strong>QR Code e o copia-e-cola</strong> com o valor já preenchido —
            para o cliente pagar na hora, ali no balcão. A cidade que aparece no app do cliente é a do endereço da
            oficina, ali em cima.
          </p>
        </div>

        <Field label="Chave Pix" htmlFor="pix-key" hint="CPF, CNPJ, telefone, e-mail ou chave aleatória.">
          <Input
            {...fieldA11y('pix-key', undefined, true)}
            placeholder="oficina@email.com"
            disabled={!canEdit || settings.isPending}
            value={chaveAtual}
            onChange={(evento) => setChave(evento.target.value)}
            onBlur={() => {
              const nova = chaveAtual.trim();
              if (nova === (settings.data?.pixKey ?? '')) return;
              void gravar({ pixKey: nova }, nova ? 'Chave Pix salva.' : 'Chave Pix removida.');
            }}
          />
        </Field>

        {chaveAtual.trim() ? (
          <Alert variant="warning">
            O dinheiro cai direto na sua conta, e <strong>o banco não avisa o sistema</strong>. Confira no seu banco
            antes de liberar o carro — a baixa na OS continua sendo você que dá.
          </Alert>
        ) : (
          <Alert variant="info">
            Sem a chave, a OS não oferece Pix na hora. Nada de QR inventado: um código que não paga é pior que nenhum.
          </Alert>
        )}
      </div>
    </Card>
  );
}

/**
 * Assinatura na entrega (E28). Desligado por padrão de propósito: a maioria
 * das oficinas entrega com um aperto de mão, e travar quem não pediu isso é
 * transformar melhoria em obstáculo. Quem vive de discussão sobre "estava
 * assim quando entreguei" liga, e aí a entrega sem assinatura é recusada.
 */
function DeliveryCard() {
  const canEdit = useCan('organization:manage');
  const settings = useOrganizationSettings();
  const salvar = useUpdateOrganizationSettings();
  // a caixa marca na hora, como qualquer caixa: esperar a resposta do servidor
  // para mostrar o que a pessoa acabou de clicar parece que o clique não pegou
  const [escolha, setEscolha] = useState<boolean | null>(null);
  const exigir = escolha ?? settings.data?.requireDeliverySignature ?? false;

  return (
    <Card>
      <div className="space-y-4 p-5 md:p-6">
        <div>
          <h2 className="text-sm font-semibold">Entrega do veículo</h2>
          <p className="mt-1 text-sm text-muted">
            Na hora de entregar, a OS oferece assinatura na tela, fotos do carro e o km da saída. Tudo opcional — a não
            ser que você marque abaixo.
          </p>
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            disabled={!canEdit || settings.isPending}
            checked={exigir}
            onChange={async (event) => {
              const novo = event.target.checked;
              setEscolha(novo);
              try {
                await salvar.mutateAsync({ requireDeliverySignature: novo });
                toast.success(novo ? 'A entrega passa a exigir assinatura.' : 'A assinatura voltou a ser opcional.');
              } catch (err) {
                toast.error(errorMessage(err));
                setEscolha(null);
              }
            }}
          />
          <span>
            Exigir a assinatura de quem recebe o veículo
            <span className="block text-xs text-muted">
              Com isto ligado, não dá para entregar sem colher a assinatura na tela.
            </span>
          </span>
        </label>
      </div>
    </Card>
  );
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
    setValue,
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
            <Field label="CEP" htmlFor="zip" error={e.address?.zip?.message} hint="Preenche o resto do endereço sozinho.">
              <CepInput id="zip" registro={register('address.zip')} setValue={setValue} onErro={(aviso) => toast.info(aviso)} />
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
