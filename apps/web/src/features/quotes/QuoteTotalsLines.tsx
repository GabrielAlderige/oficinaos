import { formatBRL, type DiscountMode } from '@oficinaos/shared';

/** "10%" ou "12,5%" a partir de basis points. */
export function percentualDoDesconto(bps: number): string {
  return `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/**
 * Subtotal, desconto, acréscimo e total do orçamento: o mesmo bloco na prévia
 * de envio, no cartão e no registro manual, para os três nunca divergirem.
 * Sem desconto nem acréscimo, só a linha do total.
 */
export function QuoteTotalsLines({
  totals,
  totalLabel = 'Total',
}: {
  totals: {
    subtotalCents: number;
    discountMode?: DiscountMode | null;
    discountValue?: number;
    discountCents: number;
    surchargeCents: number;
    totalCents: number;
  };
  totalLabel?: string;
}) {
  const detalhar = totals.discountCents > 0 || totals.surchargeCents > 0;
  return (
    <dl className="space-y-1 text-sm">
      {detalhar && (
        <div className="flex justify-between text-muted">
          <dt>Subtotal</dt>
          <dd className="tabular">{formatBRL(totals.subtotalCents)}</dd>
        </div>
      )}
      {totals.discountCents > 0 && (
        <div className="flex justify-between text-muted">
          <dt>
            Desconto
            {totals.discountMode === 'PERCENT' && totals.discountValue ? ` (${percentualDoDesconto(totals.discountValue)})` : ''}
          </dt>
          <dd className="tabular">− {formatBRL(totals.discountCents)}</dd>
        </div>
      )}
      {totals.surchargeCents > 0 && (
        <div className="flex justify-between text-muted">
          <dt>Acréscimo</dt>
          <dd className="tabular">{formatBRL(totals.surchargeCents)}</dd>
        </div>
      )}
      <div className="flex justify-between font-medium">
        <dt>{totalLabel}</dt>
        <dd className="tabular">{formatBRL(totals.totalCents)}</dd>
      </div>
    </dl>
  );
}
