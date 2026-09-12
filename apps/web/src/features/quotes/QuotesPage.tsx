import {
  effectiveQuoteStatus,
  formatBRL,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_TONES,
  QUOTE_STATUSES,
  type QuoteStatus,
} from '@oficinaos/shared';
import { Eye, FileText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { PlateBadge } from '../../components/plate-badge';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../../components/ui/display';
import { Select } from '../../components/ui/field';
import { EmptyState, Pagination } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { withParam } from '../../lib/search-params';
import { useQuotes, type QuoteListParams } from './api';

const GRID = 'md:grid-cols-[5rem_minmax(0,1.5fr)_minmax(0,1.4fr)_minmax(0,1fr)_8rem]';

/** O que a oficina persegue: quem ainda não respondeu, e o que já foi decidido. */
const QUICK: (QuoteStatus | 'open')[] = ['open', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'EXPIRED'];

function isStatus(value: string | null): value is QuoteStatus | 'open' | 'all' {
  return value === 'open' || value === 'all' || (QUOTE_STATUSES as readonly string[]).includes(value ?? '');
}

export function QuotesPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const statusParam = params.get('status');
  const status: QuoteListParams['status'] = isStatus(statusParam) ? statusParam : 'open';

  const quotes = useQuotes({ status, page });
  const data = quotes.data;

  return (
    <>
      <PageHeader
        title="Orçamentos"
        description="Quem recebeu o link, quem abriu e quem ainda não respondeu."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK.map((value) => {
          const active = status === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setParams(withParam(params, 'status', value === 'open' ? null : value))}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-accent bg-accent-soft font-medium text-accent dark:border-accent-bright dark:text-accent-bright'
                  : 'border-border text-muted hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {value === 'open' ? 'Aguardando resposta' : QUOTE_STATUS_LABELS[value]}
            </button>
          );
        })}
      </div>

      <Card>
        <div className="border-b border-border p-3 sm:w-64">
          <Select
            aria-label="Situação"
            value={status}
            onChange={(event) => setParams(withParam(params, 'status', event.target.value === 'open' ? null : event.target.value))}
          >
            <option value="open">Aguardando resposta</option>
            <option value="all">Todos</option>
            {QUOTE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {QUOTE_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>

        {quotes.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : quotes.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(quotes.error)}</Alert>
          </div>
        ) : !data?.data.length ? (
          status === 'open' ? (
            <EmptyState
              icon={FileText}
              title="Nenhum orçamento esperando resposta"
              description="O orçamento sai da OS: abra o carro na lista de ordens e mande o link para o cliente aprovar pelo celular."
            />
          ) : (
            <EmptyState icon={FileText} title="Nenhum orçamento nesta situação" description="Troque o filtro para ver os outros." />
          )
        ) : (
          <>
            <div className={cn('hidden gap-4 border-b border-border px-5 py-2 text-xs font-medium text-muted md:grid', GRID)}>
              <span>Orçamento</span>
              <span>Cliente</span>
              <span>Veículo</span>
              <span>Situação</span>
              <span className="text-right">Total</span>
            </div>
            <ul className={quotes.isPlaceholderData ? 'divide-y divide-border opacity-60' : 'divide-y divide-border'}>
              {data.data.map((quote) => {
                // um orçamento vencido continua gravado como "enviado": quem decide
                // o que a tela mostra é a data de validade
                const situacao = effectiveQuoteStatus(quote.status, quote.validUntil);
                return (
                  <li key={quote.id}>
                    <Link
                      to={`/ordens/${quote.workOrderNumber}`}
                      className={cn('grid gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-muted/60 md:items-center', GRID)}
                    >
                      <span className="text-sm font-semibold tabular">#{quote.number}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{quote.customerName}</span>
                        <span className="block truncate text-xs text-muted">
                          OS {quote.workOrderNumber} · enviado em {formatDate(quote.sentAt)}
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <PlateBadge plate={quote.vehiclePlate} size="sm" />
                        <span className="truncate text-sm text-muted">{quote.vehicleName}</span>
                      </span>
                      <span className="min-w-0">
                        <Badge tone={QUOTE_STATUS_TONES[situacao]}>{QUOTE_STATUS_LABELS[situacao]}</Badge>
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                          <Eye className="size-3.5" aria-hidden="true" />
                          {quote.viewCount === 0 ? 'ainda não abriu' : `visto ${quote.viewCount}×`}
                          {situacao === 'SENT' && ` · vence ${formatDate(quote.validUntil)}`}
                        </span>
                      </span>
                      <span className="text-sm font-medium tabular md:text-right">{formatBRL(quote.totalCents)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Pagination meta={data.meta} onPageChange={(next) => setParams(withParam(params, 'page', String(next)))} />
          </>
        )}
      </Card>
    </>
  );
}
