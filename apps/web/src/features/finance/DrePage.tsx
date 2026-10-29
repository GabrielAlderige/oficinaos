import { formatBRL, type DreLine } from '@oficinaos/shared';
import { Printer } from 'lucide-react';
import { PeriodPicker, usePeriodoNaUrl } from '../../components/PeriodPicker';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useDre } from './api';
import { FinanceTabs } from './FinanceTabs';
import { dataBR } from './status';

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Variação contra o período anterior, no sentido de "melhorou" ou "piorou". */
function Variacao({ atual, anterior }: { atual: number; anterior: number | undefined }) {
  if (anterior === undefined || anterior === 0 || atual === anterior) return <span className="text-muted">—</span>;
  const delta = ((atual - anterior) / Math.abs(anterior)) * 100;
  // valores de dedução são negativos: ficar "maior" (mais perto de zero) é bom
  const melhorou = atual > anterior;
  return (
    <span className={melhorou ? 'text-success' : 'text-danger'}>
      {delta > 0 ? '+' : ''}
      {delta.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
    </span>
  );
}

/**
 * Resultado do período — a DRE (E49): da receita bruta ao que sobrou, linha
 * por linha, com o peso de cada uma na receita e o mesmo período anterior ao
 * lado. A última linha é o mesmo lucro estimado do fluxo de caixa e dos
 * relatórios: o sistema tem um número só para lucro.
 */
export function DrePage() {
  const [periodo, trocarPeriodo] = usePeriodoNaUrl();
  const dre = useDre(periodo);
  const dados = dre.data;
  const anterior = new Map((dados?.previous.lines ?? []).map((linha) => [linha.label, linha.amountCents]));
  const resultado = dados?.lines.find((linha) => linha.key === 'resultado');

  return (
    <>
      <PageHeader
        title="Resultado (DRE)"
        description="Da receita ao que sobrou no período, linha por linha."
        actions={
          <>
            <PeriodPicker idPrefix="dre" valor={periodo} onChange={trocarPeriodo} />
            <Button variant="secondary" onClick={() => window.print()} className="print:hidden">
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
        <Card>
          <CardHeader
            title={`Demonstração do resultado · ${dataBR(dados.from)} a ${dataBR(dados.to)}`}
            description={
              resultado
                ? `${resultado.amountCents >= 0 ? 'Sobraram' : 'Faltaram'} ${formatBRL(Math.abs(resultado.amountCents))}: ${pct(resultado.shareBps)} da receita.`
                : undefined
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-y border-border text-xs text-muted">
                  <th scope="col" className="px-5 py-2 text-left font-medium">
                    Linha
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
                {dados.lines.map((linha) => (
                  <Linha key={linha.key} linha={linha} anterior={anterior.get(linha.label)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-5 py-3 text-xs text-muted">
            A receita entra pelo que foi entregue no período (OS finalizada e venda de balcão); as despesas, pelo que
            foi pago. A compra de peças não aparece como despesa: ela já está no custo das peças vendidas, e contar as
            duas descontaria a mesma peça duas vezes. Para a contabilidade oficial, leve este quadro ao seu contador.
          </p>
        </Card>
      ) : null}
    </>
  );
}

function Linha({ linha, anterior }: { linha: DreLine; anterior: number | undefined }) {
  const subtotal = linha.kind === 'subtotal' || linha.kind === 'resultado';
  return (
    <tr
      className={cn(
        'border-b border-border last:border-0',
        subtotal && 'bg-surface-muted/50 font-semibold',
        linha.kind === 'resultado' && 'text-base',
      )}
    >
      <th scope="row" className={cn('px-5 py-2 text-left font-normal', subtotal && 'font-semibold', linha.kind === 'deducao' && 'pl-9')}>
        {linha.label}
      </th>
      <td
        className={cn(
          'px-3 py-2 text-right tabular',
          linha.kind === 'resultado' && (linha.amountCents < 0 ? 'text-danger' : 'text-success'),
        )}
      >
        {linha.amountCents < 0 ? '−' : ''}
        {formatBRL(Math.abs(linha.amountCents))}
      </td>
      <td className="px-3 py-2 text-right text-muted tabular">{pct(linha.shareBps)}</td>
      <td className="px-3 py-2 text-right text-muted tabular">
        {anterior === undefined ? '—' : `${anterior < 0 ? '−' : ''}${formatBRL(Math.abs(anterior))}`}
      </td>
      <td className="px-5 py-2 text-right tabular">
        <Variacao atual={linha.amountCents} anterior={anterior} />
      </td>
    </tr>
  );
}
