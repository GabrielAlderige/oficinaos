import { formatBRL, TAX_REGIME_LABELS, type Dre, type DreLine } from '@oficinaos/shared';
import { ChevronDown, ChevronRight, Plus, Printer, SearchCheck, Settings2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PeriodPicker, usePeriodoNaUrl } from '../../components/PeriodPicker';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useRegimeLookup } from '../invoices/api';
import { useDre } from './api';
import { EntryFormDialog } from './EntryFormDialog';
import { FinanceTabs } from './FinanceTabs';
import { dataBR } from './status';

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Valor como o contador escreve: negativo entre parênteses. */
const contabil = (cents: number) => (cents < 0 ? `(${formatBRL(-cents)})` : formatBRL(cents));

/** Variação contra o período anterior, no sentido de "melhorou" ou "piorou". */
function Variacao({ atual, anterior }: { atual: number; anterior: number | undefined }) {
  if (anterior === undefined || anterior === 0 || atual === anterior) return <span className="text-muted">—</span>;
  const delta = ((atual - anterior) / Math.abs(anterior)) * 100;
  // dedução e despesa são negativas: ficar "maior" (mais perto de zero) é bom
  const melhorou = atual > anterior;
  return (
    <span className={melhorou ? 'text-success' : 'text-danger'}>
      {delta > 0 ? '+' : ''}
      {delta.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
    </span>
  );
}

/**
 * Resultado do período — a DRE (E51): por competência, com os impostos
 * calculados pelo regime da oficina. Cada grupo mostra o TOTAL em cima e os
 * itens embaixo (sintética e analíticas), como na DRE do contador.
 */
export function DrePage() {
  const [periodo, trocarPeriodo] = usePeriodoNaUrl();
  const [lancando, setLancando] = useState(false);
  const podeLancar = useCan('finance:write');
  const dre = useDre(periodo);
  const dados = dre.data;

  return (
    <>
      <PageHeader
        title="Resultado (DRE)"
        description="Da receita ao lucro líquido, por competência, com os impostos do seu regime."
        actions={
          <>
            <PeriodPicker idPrefix="dre" valor={periodo} onChange={trocarPeriodo} />
            {podeLancar && (
              <Button variant="secondary" onClick={() => setLancando(true)} className="print:hidden">
                <Plus />
                Lançar despesa
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()} className="hidden sm:inline-flex print:hidden">
              <Printer />
              Imprimir
            </Button>
          </>
        }
      />
      <div className="print:hidden">
        <FinanceTabs />
      </div>

      {dre.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : dre.isError ? (
        <Alert variant="danger">{errorMessage(dre.error)}</Alert>
      ) : dados ? (
        <div className="space-y-4">
          <Regime dados={dados} />
          <Resumo dados={dados} />
          <Tabela dados={dados} />
        </div>
      ) : null}

      <EntryFormDialog direction="PAYABLE" open={lancando} onOpenChange={setLancando} />
    </>
  );
}

/** De onde vêm os impostos: o regime, quem disse, e a faixa do Simples. */
function Regime({ dados }: { dados: Dre }) {
  const { regime } = dados;
  const pode = useCan('organization:manage');
  const consultar = useRegimeLookup();

  async function consultarReceita() {
    try {
      const { result, settings } = await consultar.mutateAsync();
      if (result === 'SEM_CNPJ') toast.error('Cadastre o CNPJ da oficina em Configurações → Oficina para consultar a Receita.');
      else if (result === 'ATUALIZADO') toast.success('Regime atualizado pela Receita.');
      else toast.warning(settings.taxRegimeDetail ?? 'A Receita não informou o regime.');
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  }

  if (!regime.regime) {
    return (
      <Alert variant="warning">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>Os impostos estão fora da DRE:</strong> falta o regime tributário da oficina.{' '}
            {regime.detail ?? 'O sistema descobre pelo CNPJ do cadastro, ou você escolhe nas configurações fiscais.'}
          </span>
          {pode && (
            <span className="flex flex-wrap gap-2 print:hidden">
              <Button size="sm" variant="secondary" loading={consultar.isPending} onClick={() => void consultarReceita()}>
                <SearchCheck />
                Consultar na Receita
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <Link to="/configuracoes/fiscal">
                  <Settings2 />
                  Escolher o regime
                </Link>
              </Button>
            </span>
          )}
        </div>
      </Alert>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <div className="min-w-0">
        <p>
          Regime: <strong>{TAX_REGIME_LABELS[regime.regime]}</strong>
          <span className="text-muted">
            {' · '}
            {regime.source === 'RECEITA' ? (regime.detail ?? 'consultado na Receita') : 'escolhido pela oficina'}
          </span>
        </p>
        {regime.simples.length > 0 && (
          <p className="mt-0.5 text-xs text-muted">
            {regime.simples
              .map((s) => `Anexo ${s.anexo} (${s.anexo === 'III' ? 'serviços' : 'peças'}), faixa ${s.faixa}: alíquota efetiva ${pct(s.efetivaBps)}`)
              .join(' · ')}
          </p>
        )}
        {regime.avisos.map((aviso) => (
          <p key={aviso} className="mt-0.5 text-xs text-warning">
            {aviso}
          </p>
        ))}
      </div>
      <Link to="/configuracoes/fiscal" className="text-sm underline underline-offset-2 print:hidden">
        Configurar impostos
      </Link>
    </div>
  );
}

function Resumo({ dados }: { dados: Dre }) {
  const v = (key: string) => dados.lines.find((l) => l.key === key);
  const bruta = v('receita_bruta')?.amountCents ?? 0;
  const impostos = (v('deducoes')?.amountCents ?? 0) + (v('provisao_ir')?.amountCents ?? 0);
  const lucroBruto = v('lucro_bruto');
  const liquido = v('lucro_liquido');
  const tiles: { rotulo: string; valor: number; detalhe: string; destaque?: boolean }[] = [
    { rotulo: 'Receita bruta', valor: bruta, detalhe: `${dataBR(dados.from)} a ${dataBR(dados.to)}` },
    { rotulo: 'Impostos', valor: impostos, detalhe: bruta > 0 ? `${pct(Math.round((-impostos / bruta) * 10_000))} da receita` : '—' },
    { rotulo: 'Lucro bruto', valor: lucroBruto?.amountCents ?? 0, detalhe: `margem de ${pct(lucroBruto?.shareBps ?? 0)}` },
    { rotulo: 'Lucro líquido', valor: liquido?.amountCents ?? 0, detalhe: `margem de ${pct(liquido?.shareBps ?? 0)}`, destaque: true },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.rotulo} className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-sm text-muted">{t.rotulo}</p>
          <p
            className={cn(
              'mt-1 text-xl font-semibold tabular',
              t.destaque && t.valor < 0 && 'text-danger',
              t.destaque && t.valor > 0 && 'text-success',
            )}
          >
            {contabil(t.valor)}
          </p>
          <p className="mt-0.5 text-xs text-muted">{t.detalhe}</p>
        </div>
      ))}
    </div>
  );
}

function Tabela({ dados }: { dados: Dre }) {
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const anterior = new Map(dados.previous.lines.map((linha) => [linha.key, linha.amountCents]));
  const grupos = dados.lines.filter((l) => l.kind === 'grupo').map((l) => l.key);
  const tudoRecolhido = grupos.length > 0 && grupos.every((g) => recolhidos.has(g));

  const alternar = (key: string) =>
    setRecolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(key)) novo.delete(key);
      else novo.add(key);
      return novo;
    });

  return (
    <Card>
      <CardHeader
        title={`Demonstração do resultado · ${dataBR(dados.from)} a ${dataBR(dados.to)}`}
        description="Cada grupo traz o total em cima e o que o compõe logo abaixo."
        action={
          <Button
            size="sm"
            variant="ghost"
            className="print:hidden"
            onClick={() => setRecolhidos(tudoRecolhido ? new Set() : new Set(grupos))}
          >
            {tudoRecolhido ? 'Mostrar os itens' : 'Só os totais'}
          </Button>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-y border-border text-xs text-muted">
              <th scope="col" className="px-5 py-2 text-left font-medium">
                Conta
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Valor
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                % da receita
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {dataBR(dados.previous.from)} a {dataBR(dados.previous.to)}
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                Variação
              </th>
            </tr>
          </thead>
          <tbody>
            {dados.lines.map((linha) =>
              linha.kind === 'item' && linha.parent && recolhidos.has(linha.parent) ? null : (
                <Fragment key={linha.key}>
                  <Linha
                    linha={linha}
                    anterior={anterior.get(linha.key)}
                    aberto={!recolhidos.has(linha.key)}
                    onAlternar={linha.kind === 'grupo' ? () => alternar(linha.key) : undefined}
                    vazio={linha.kind === 'grupo' && !dados.lines.some((l) => l.parent === linha.key)}
                  />
                </Fragment>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-5 py-3 text-xs text-muted">
        Por competência: a OS entra no mês em que foi finalizada (paga ou não) e a venda de balcão no dia da venda; a
        despesa, pelo mês de competência do lançamento (sem ele, o do vencimento). A compra de peças não aparece como
        despesa: a peça já está no custo das peças vendidas. Os impostos são calculados sobre o faturamento pela regra do
        regime; os valores oficiais são os do seu contador.
      </p>
    </Card>
  );
}

function Linha({ linha, anterior, aberto, onAlternar, vazio }: {
  linha: DreLine;
  anterior: number | undefined;
  aberto: boolean;
  onAlternar?: () => void;
  vazio: boolean;
}) {
  const grupo = linha.kind === 'grupo';
  const resultado = linha.kind === 'resultado';
  const final = linha.key === 'lucro_liquido';
  return (
    <tr
      className={cn(
        'border-b border-border last:border-0',
        grupo && 'font-semibold',
        resultado && 'bg-surface-muted/60 font-semibold',
        final && 'text-base',
      )}
    >
      <th scope="row" className={cn('px-5 py-2 text-left font-normal', (grupo || resultado) && 'font-semibold', linha.kind === 'item' && 'pl-12')}>
        {grupo && onAlternar && !vazio ? (
          <button
            type="button"
            onClick={onAlternar}
            aria-expanded={aberto}
            className="-ml-1 inline-flex items-center gap-1 rounded text-left hover:text-accent print:pointer-events-none"
          >
            {aberto ? <ChevronDown className="size-4 print:hidden" aria-hidden="true" /> : <ChevronRight className="size-4 print:hidden" aria-hidden="true" />}
            {linha.label}
          </button>
        ) : (
          <span className={cn(grupo && 'pl-5')}>{linha.label}</span>
        )}
      </th>
      <td
        className={cn(
          'px-3 py-2 text-right tabular',
          linha.amountCents < 0 && 'text-danger',
          final && linha.amountCents > 0 && 'text-success',
        )}
      >
        {contabil(linha.amountCents)}
      </td>
      <td className="px-3 py-2 text-right text-muted tabular">{pct(linha.shareBps)}</td>
      <td className="px-3 py-2 text-right text-muted tabular">{anterior === undefined ? '—' : contabil(anterior)}</td>
      <td className="px-5 py-2 text-right tabular">
        <Variacao atual={linha.amountCents} anterior={anterior} />
      </td>
    </tr>
  );
}
