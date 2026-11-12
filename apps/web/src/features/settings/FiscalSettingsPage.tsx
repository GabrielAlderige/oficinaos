import {
  FISCAL_ENVIRONMENT_LABELS,
  formatBRLInput,
  formatPercentInput,
  parseBRL,
  parsePercent,
  TAX_REGIME_LABELS,
  TAX_REGIMES,
  type FiscalSettings,
  type TaxRegime,
} from '@oficinaos/shared';
import { FlaskConical, SearchCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Field, Select, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Input } from '../../components/ui/input';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useFiscalSettings, useRegimeLookup, useUpdateFiscalSettings } from '../invoices/api';

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
    productCfop: settings.productCfop ?? '',
    productIcmsSituation: settings.productIcmsSituation ?? '',
    partsIcmsSt: settings.partsIcmsSt,
    icmsRate: settings.icmsRateBps !== null ? formatPercentInput(settings.icmsRateBps) : '',
    meiDas: settings.meiDasCents !== null ? formatBRLInput(settings.meiDasCents) : '',
  });
  const consultar = useRegimeLookup();

  async function consultarReceita() {
    try {
      const { result, settings: novo } = await consultar.mutateAsync();
      if (result === 'SEM_CNPJ') {
        toast.error('Cadastre o CNPJ da oficina na aba Oficina para consultar a Receita.');
        return;
      }
      if (novo.taxRegime) setForm((atual) => ({ ...atual, taxRegime: novo.taxRegime ?? '' }));
      if (result === 'ATUALIZADO') toast.success(`Regime encontrado: ${novo.taxRegime ? TAX_REGIME_LABELS[novo.taxRegime] : ''}.`);
      else toast.warning(novo.taxRegimeDetail ?? 'A Receita não informou o regime.');
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

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
    const icms = form.icmsRate.trim() === '' ? null : parsePercent(form.icmsRate);
    if (form.icmsRate.trim() !== '' && icms === null) {
      toast.error('Alíquota de ICMS inválida. Use algo como 18.');
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
        productCfop: vazioVira(form.productCfop),
        productIcmsSituation: vazioVira(form.productIcmsSituation),
        partsIcmsSt: form.partsIcmsSt,
        icmsRateBps: icms,
        meiDasCents: form.meiDas.trim() === '' ? null : (parseBRL(form.meiDas) ?? null),
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
          <Field label="Inscrição estadual" htmlFor="ie" hint="Necessária para a nota de peças (NFC-e e NF-e).">
            <Input
              {...fieldA11y('ie')}
              value={form.stateRegistration}
              onChange={(event) => campo('stateRegistration', event.target.value)}
              disabled={!pode}
            />
          </Field>
          <Field
            label="Regime tributário"
            htmlFor="regime"
            hint={
              settings.taxRegimeSource === 'RECEITA' && settings.taxRegimeDetail
                ? `${settings.taxRegimeDetail}. Confira com o seu contador.`
                : settings.taxRegimeSource === 'MANUAL'
                  ? 'Escolhido pela oficina. Ele define os impostos da DRE.'
                  : (settings.taxRegimeDetail ?? 'Ele define os impostos calculados na DRE.')
            }
          >
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
            {pode && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                loading={consultar.isPending}
                onClick={() => void consultarReceita()}
              >
                <SearchCheck />
                Consultar na Receita pelo CNPJ
              </Button>
            )}
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

          <div className="border-t border-border pt-4 sm:col-span-2">
            <h3 className="text-sm font-semibold">Impostos da DRE</h3>
            <p className="text-xs text-muted">
              A DRE calcula os impostos sobre o faturamento pelo regime acima: Simples pela faixa dos últimos 12 meses,
              Presumido e Real pelas alíquotas da lei. O ISS usa a alíquota do município, informada acima.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-accent"
              checked={form.partsIcmsSt}
              onChange={(event) => campo('partsIcmsSt', event.target.checked)}
              disabled={!pode}
            />
            <span>
              As peças vêm com ICMS-ST (substituição tributária)
              <span className="block text-xs text-muted">
                É o caso da maioria das autopeças: o ICMS já foi pago na compra e a revenda não paga de novo. Desmarque
                só se o seu contador disser que a oficina recolhe ICMS na venda da peça.
              </span>
            </span>
          </label>
          {!form.partsIcmsSt && (
            <Field label="Alíquota de ICMS das peças" htmlFor="icms-aliquota" hint="Fora do Simples. Ex.: 18% em MG.">
              <AdornedInput
                {...fieldA11y('icms-aliquota')}
                trailing="%"
                inputMode="decimal"
                value={form.icmsRate}
                onChange={(event) => campo('icmsRate', event.target.value)}
                disabled={!pode}
              />
            </Field>
          )}
          {form.taxRegime === 'MEI' && (
            <Field label="Valor do DAS-MEI" htmlFor="das-mei" hint="O valor fixo da guia mensal, como vem no app do MEI.">
              <AdornedInput
                {...fieldA11y('das-mei')}
                leading="R$"
                inputMode="numeric"
                value={form.meiDas}
                onChange={(event) => campo('meiDas', formatBRLInput(parseBRL(event.target.value) ?? 0))}
                disabled={!pode}
              />
            </Field>
          )}

          <div className="border-t border-border pt-4 sm:col-span-2">
            <h3 className="text-sm font-semibold">Nota de peças (NFC-e e NF-e)</h3>
            <p className="text-xs text-muted">
              No Simples Nacional e no MEI pode deixar em branco: sai CFOP 5102 e CSOSN 102. Fora do Simples, confirme
              os dois com o seu contador. Cada peça precisa do NCM cadastrado na ficha dela.
            </p>
          </div>
          <Field label="CFOP da venda de peças" htmlFor="cfop" hint="Venda dentro do estado. Em branco: 5102.">
            <Input
              {...fieldA11y('cfop')}
              inputMode="numeric"
              value={form.productCfop}
              onChange={(event) => campo('productCfop', event.target.value)}
              placeholder="5102"
              disabled={!pode}
            />
          </Field>
          <Field label="Situação do ICMS das peças" htmlFor="icms" hint="CST ou CSOSN. Em branco no Simples: 102.">
            <Input
              {...fieldA11y('icms')}
              inputMode="numeric"
              value={form.productIcmsSituation}
              onChange={(event) => campo('productIcmsSituation', event.target.value)}
              placeholder="102"
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
