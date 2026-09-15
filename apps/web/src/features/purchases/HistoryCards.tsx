import { formatBRL, PRICE_SOURCES, SUPPLIER_QUOTE_STATUS_LABELS, type SupplierQuoteStatus } from '@oficinaos/shared';
import { Link } from 'react-router';
import { Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { formatDate } from '../../lib/format';
import { usePartPriceHistory, useSupplierHistory } from './api';
import { PurchaseStatusBadge } from './status';

const ORIGEM: Record<(typeof PRICE_SOURCES)[number], string> = {
  RFQ: 'Cotação',
  PURCHASE: 'Compra',
  PRICE_LIST: 'Tabela',
  PROVIDER: 'Pesquisa',
};

/**
 * Na ficha do fornecedor: as cotações que ele recebeu (e se respondeu) e os
 * pedidos feitos a ele. Os pedidos só vêm para quem vê compras — a API manda
 * `null` para os outros, e a tela simplesmente não mostra a seção.
 */
export function SupplierHistoryCard({ supplierId }: { supplierId: string }) {
  const historico = useSupplierHistory(supplierId);
  const dados = historico.data;

  return (
    <Card>
      <CardHeader title="Cotações e compras" description="O que a oficina já pediu a este fornecedor." />
      {historico.isPending ? (
        <div className="p-5">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !dados ? null : (
        <div className="divide-y divide-border">
          {dados.purchases !== null && (
            <section className="px-5 py-3">
              <h3 className="mb-2 text-xs font-medium text-muted">Pedidos de compra</h3>
              {dados.purchases.length ? (
                <ul className="space-y-1.5">
                  {dados.purchases.map((pedido) => (
                    <li key={pedido.id}>
                      <Link to={`/compras/${pedido.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm hover:underline">
                        <span>
                          Pedido nº {pedido.number} <span className="text-muted">· {formatDate(pedido.createdAt)}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="tabular">{formatBRL(pedido.totalCents)}</span>
                          <PurchaseStatusBadge status={pedido.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nenhum pedido ainda.</p>
              )}
            </section>
          )}
          <section className="px-5 py-3">
            <h3 className="mb-2 text-xs font-medium text-muted">Cotações</h3>
            {dados.quotes.length ? (
              <ul className="space-y-1.5">
                {dados.quotes.map((cotacao) => (
                  <li key={cotacao.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    {cotacao.workOrderNumber ? (
                      <Link to={`/ordens/${cotacao.workOrderNumber}/cotacoes/${cotacao.id}`} className="hover:underline">
                        Cotação nº {cotacao.number} <span className="text-muted">· OS {cotacao.workOrderNumber} · {formatDate(cotacao.createdAt)}</span>
                      </Link>
                    ) : (
                      <span>
                        Cotação nº {cotacao.number} <span className="text-muted">· {formatDate(cotacao.createdAt)}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-2">
                      <Badge tone={cotacao.answered ? 'success' : 'neutral'}>{cotacao.answered ? 'Respondeu' : 'Não respondeu'}</Badge>
                      <span className="text-xs text-muted">{SUPPLIER_QUOTE_STATUS_LABELS[cotacao.status as SupplierQuoteStatus] ?? cotacao.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nenhuma cotação enviada a ele ainda.</p>
            )}
          </section>
        </div>
      )}
    </Card>
  );
}

/** Na ficha da peça: quanto cada fornecedor cobrou, em cotação e em compra. É custo. */
export function PartPriceHistoryCard({ partId }: { partId: string }) {
  const historico = usePartPriceHistory(partId, true);
  const linhas = historico.data ?? [];

  return (
    <Card>
      <CardHeader title="Histórico de preços" description="Preço de fornecedor, sem frete: o cotado e o que foi pago nas compras." />
      {historico.isPending ? (
        <div className="p-5">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !linhas.length ? (
        <p className="px-5 py-4 text-sm text-muted">Nenhum preço registrado ainda. Ele aparece com a primeira cotação escolhida ou compra recebida.</p>
      ) : (
        <ul className="divide-y divide-border">
          {linhas.map((linha) => (
            <li key={linha.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{linha.supplier?.name ?? 'Fornecedor removido'}</span>
                <span className="block text-xs text-muted">
                  {formatDate(linha.capturedAt)} ·{' '}
                  {linha.purchaseOrder ? (
                    <Link to={`/compras/${linha.purchaseOrder.id}`} className="hover:underline">
                      pedido nº {linha.purchaseOrder.number}
                    </Link>
                  ) : linha.supplierQuote ? (
                    linha.supplierQuote.workOrderNumber ? (
                      <Link to={`/ordens/${linha.supplierQuote.workOrderNumber}/cotacoes/${linha.supplierQuote.id}`} className="hover:underline">
                        cotação nº {linha.supplierQuote.number}
                      </Link>
                    ) : (
                      `cotação nº ${linha.supplierQuote.number}`
                    )
                  ) : null}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={linha.source === 'PURCHASE' ? 'success' : 'info'}>{ORIGEM[linha.source as keyof typeof ORIGEM] ?? linha.source}</Badge>
                <span className="font-medium tabular">{formatBRL(linha.priceCents)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
