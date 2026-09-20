import {
  FISCAL_ENVIRONMENT_LABELS,
  formatPercentInput,
  parsePercent,
  TAX_REGIME_LABELS,
  TAX_REGIMES,
  type FiscalSettings,
  type TaxRegime,
} from '@oficinaos/shared';
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Field, Select, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Input } from '../../components/ui/input';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useFiscalSettings, useUpdateFiscalSettings } from '../invoices/api';

/**
 * Dados fiscais da oficina (E18). É o que a prefeitura exige para aceitar a
 * NFS-e: inscrição municipal, regime, item da lista de serviços e alíquota.
 *
 * Certificado digital NÃO fica aqui de propósito: quem assina a nota é o
 * emissor, e o certificado vai direto para ele. Segredo que não passa pelo
 * nosso banco é segredo que não vaza do nosso banco.
 */
export function FiscalSettingsPage() {
  const dados = useFiscalSettings();
  return dados.isPending ? (
    <Card className="space-y-4 p-6" aria-label="Carregando dados fiscais">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </Card>
  ) : dados.isError ? (
    <Alert variant="danger">{errorMessage(dados.error)}</Alert>
  ) : (
    <FiscalForm settings={dados.data} />
  );
}

function FiscalForm({ settings }: { settings: FiscalSettings }) {
  const pode = useCan('organization:manage');
  const salvar = useUpdateFiscalSettings();
  const [form, setForm] = useState({
    municipalRegistration: settings.municipalRegistration ?? '',
    stateRegistration: settings.stateRegistration ?? '',
    taxRegime: settings.taxRegime ?? '',
    cnae: settings.cnae ?? '',
    serviceListItem: settings.serviceListItem ?? '',
    municipalServiceCode: settings.municipalServiceCode ?? '',
    issRate: settings.issRateBps !== null ? formatPercentInput(settings.issRateBps) : '',
    issRetainedDefault: settings.issRetainedDefault,
    rpsSeries: settings.rpsSeries,
    additionalInformation: settings.additionalInformation ?? '',
  });

  const campo = <K extends keyof typeof form>(chave: K, valor: (typeof form)[K]) =>
    setForm((atual) => ({ ...atual, [chave]: valor }));

  const vazioVira = (valor: string) => (valor.trim() === '' ? null : valor.trim());

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    const aliquota = form.issRate.trim() === '' ? null : parsePercent(form.issRate);
    if (form.issRate.trim() !== '' && aliquota === null) {
      toast.error('Alíquota de ISS inválida. Use algo como 2,5.');
      return;
    }
    try {
      await salvar.mutateAsync({
        municipalRegistration: vazioVira(form.municipalRegistration),
        stateRegistration: vazioVira(form.stateRegistration),
        taxRegime: (vazioVira(form.taxRegime) as TaxRegime | null) ?? null,
        cnae: vazioVira(form.cnae),
        serviceListItem: vazioVira(form.serviceListItem),
        municipalServiceCode: vazioVira(form.municipalServiceCode),
        issRateBps: aliquota,
        issRetainedDefault: form.issRetainedDefault,
        rpsSeries: form.rpsSeries.trim() || '1',
        additionalInformation: vazioVira(form.additionalInformation),
      });
      toast.success('Dados fiscais salvos.');
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

  return (
    <div className="space-y-6">
      {settings.environment === 'SIMULATOR' && (
        <Alert variant="warning">
          <span className="flex items-start gap-2">
            <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>Emissor em modo simulação.</strong> {FISCAL_ENVIRONMENT_LABELS.SIMULATOR}. Dá para percorrer o
              fluxo inteiro — conferir, emitir, cancelar — mas nada é enviado à prefeitura. Para valer, é preciso
              contratar um emissor e configurar a credencial no servidor.
            </span>
          </span>
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Dados para a nota de serviço"
          description="O que a prefeitura exige para aceitar a NFS-e. O CNPJ, a razão social e o endereço vêm da aba Oficina."
        />
        <form className="grid gap-4 px-5 pb-5 sm:grid-cols-2" onSubmit={enviar}>
          <Field label="Inscrição municipal" htmlFor="im" hint="É ela que identifica a oficina na prefeitura.">
            <Input
              {...fieldA11y('im')}
              value={form.municipalRegistration}
              onChange={(event) => campo('municipalRegistration', event.target.value)}
              disabled={!pode}
            />
          </Field>
          <Field label="Inscrição estadual" htmlFor="ie" hint="Só necessária para nota de peça (etapa futura).">
            <Input
              {...fieldA11y('ie')}
              value={form.stateRegistration}
              onChange={(event) => campo('stateRegistration', event.target.value)}
              disabled={!pode}
            />
          </Field>
          <Field label="Regime tributário" htmlFor="regime">
            <Select
              {...fieldA11y('regime')}
              value={form.taxRegime}
              onChange={(event) => campo('taxRegime', event.target.value)}
              disabled={!pode}
            >
              <option value="">Selecione</option>
              {TAX_REGIMES.map((regime) => (
                <option key={regime} value={regime}>
                  {TAX_REGIME_LABELS[regime]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="CNAE principal" htmlFor="cnae">
            <Input
              {...fieldA11y('cnae')}
              value={form.cnae}
              onChange={(event) => campo('cnae', event.target.value)}
              placeholder="4520-0/01"
              disabled={!pode}
            />
          </Field>
          <Field
            label="Item da lista de serviços"
            htmlFor="item-lista"
            hint="LC 116. Para oficina costuma ser 14.01 (manutenção de veículos)."
          >
            <Input
              {...fieldA11y('item-lista')}
              value={form.serviceListItem}
              onChange={(event) => campo('serviceListItem', event.target.value)}
              placeholder="14.01"
              disabled={!pode}
            />
          </Field>
          <Field label="Código do serviço no município" htmlFor="codigo-municipal" hint="Alguns municípios usam código próprio.">
            <Input
              {...fieldA11y('codigo-municipal')}
              value={form.municipalServiceCode}
              onChange={(event) => campo('municipalServiceCode', event.target.value)}
              disabled={!pode}
            />
          </Field>
          <Field label="Alíquota de ISS" htmlFor="iss" hint="A do seu município, entre 2% e 5%.">
            <AdornedInput
              {...fieldA11y('iss')}
              trailing="%"
              inputMode="decimal"
              value={form.issRate}
              onChange={(event) => campo('issRate', event.target.value)}
              disabled={!pode}
            />
          </Field>
          <Field label="Série do RPS" htmlFor="serie" hint="A numeração é sua; a da nota vem da prefeitura.">
            <Input
              {...fieldA11y('serie')}
              value={form.rpsSeries}
              onChange={(event) => campo('rpsSeries', event.target.value)}
              disabled={!pode}
            />
          </Field>

          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-accent"
              checked={form.issRetainedDefault}
              onChange={(event) => campo('issRetainedDefault', event.target.checked)}
              disabled={!pode}
            />
            <span>
              Por padrão, o tomador retém o ISS
              <span className="block text-xs text-muted">
                Marque só se a maioria dos seus clientes for empresa que recolhe o imposto no lugar da oficina.
              </span>
            </span>
          </label>

          <Field
            label="Observação fixa na nota"
            htmlFor="obs-nota"
            className="sm:col-span-2"
            hint="Vai no fim da descrição de toda nota (ex.: prazo de garantia)."
          >
            <Input
              {...fieldA11y('obs-nota')}
              value={form.additionalInformation}
              onChange={(event) => campo('additionalInformation', event.target.value)}
              disabled={!pode}
            />
          </Field>

          {pode && (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={salvar.isPending}>
                {salvar.isPending ? 'Salvando…' : 'Salvar dados fiscais'}
              </Button>
            </div>
          )}
        </form>
      </Card>

      <Card>
        <CardHeader title="Emissor" description="Quem assina e manda a nota para a prefeitura." />
        <div className="space-y-2 px-5 pb-5 text-sm">
          <p>
            Driver atual: <strong>{settings.provider ?? 'simulador'}</strong> ·{' '}
            {FISCAL_ENVIRONMENT_LABELS[settings.environment]}
          </p>
          <p className="text-muted">
            Para emitir de verdade: contrate um emissor de NFS-e, cadastre a oficina lá (com o certificado digital
            A1) e configure a credencial no servidor. O certificado nunca é guardado aqui. Depois disso, as notas
            emitidas por esta tela passam a valer.
          </p>
          <p className="text-muted">
            As notas já emitidas ficam em{' '}
            <Link className="underline underline-offset-2" to="/notas">
              Notas fiscais
            </Link>
            .
          </p>
        </div>
      </Card>
    </div>
  );
}
