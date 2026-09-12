import {
  APPROVAL_CHANNEL_LABELS,
  APPROVAL_DECISION_LABELS,
  formatBRL,
  QUOTE_KIND_LABELS,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_TONES,
  type Quote,
  type WorkOrder,
} from '@oficinaos/shared';
import { Check, Copy, Eye, MessageCircle, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader } from '../../components/ui/display';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime, formatRelative } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useQuote, useShareQuote } from './api';
import { ManualDecisionDialog } from './ManualDecisionDialog';
import { SendQuoteDialog } from './SendQuoteDialog';

/**
 * O orçamento na tela da OS: é daqui que a oficina manda o link e acompanha a
 * resposta. Quando não há orçamento aberto, o cartão convida a enviar — é o
 * fluxo que o produto inteiro existe para servir.
 */
export function QuoteCard({ order, quoteId }: { order: WorkOrder; quoteId: string | null }) {
  const canSend = useCan('quotes:send');
  const [sending, setSending] = useState(false);
  const quote = useQuote(quoteId);

  if (!quoteId) {
    const semItens = order.items.length === 0;
    return (
      <Card>
        <CardHeader title="Orçamento" description="Mande o link e deixe o cliente aprovar pelo celular." />
        <div className="px-5 py-5">
          {semItens ? (
            <p className="text-sm text-muted">Adicione serviços e peças à OS para poder orçar.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                {order.items.length} {order.items.length === 1 ? 'item' : 'itens'} prontos para orçar ·{' '}
                {formatBRL(order.totals.totalCents)}
              </p>
              {canSend && (
                <Button onClick={() => setSending(true)}>
                  <Send />
                  Enviar orçamento
                </Button>
              )}
            </>
          )}
        </div>
        <SendQuoteDialog order={order} open={sending} onOpenChange={setSending} />
      </Card>
    );
  }

  if (quote.isPending) {
    return (
      <Card>
        <CardHeader title="Orçamento" />
        <p className="px-5 py-5 text-sm text-muted">Carregando…</p>
      </Card>
    );
  }
  if (quote.isError || !quote.data) {
    return (
      <Card>
        <CardHeader title="Orçamento" />
        <div className="px-5 py-5">
          <Alert variant="danger">{errorMessage(quote.error)}</Alert>
        </div>
      </Card>
    );
  }

  return <QuoteDetail order={order} quote={quote.data} />;
}

function QuoteDetail({ order, quote }: { order: WorkOrder; quote: Quote }) {
  const canSend = useCan('quotes:send');
  const canRecord = useCan('quotes:record_manual_approval');
  const share = useShareQuote(quote.id);
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const aguardando = quote.status === 'SENT';

  async function copiar() {
    try {
      await navigator.clipboard.writeText(quote.publicUrl);
      await share.mutateAsync('COPY_LINK');
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }

  async function enviarWhatsApp() {
    try {
      const { whatsappUrl, message } = await share.mutateAsync('WHATSAPP_LINK');
      if (whatsappUrl) {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      await navigator.clipboard.writeText(message);
      toast.success('O cliente não tem WhatsApp cadastrado. A mensagem foi copiada.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {QUOTE_KIND_LABELS[quote.kind]} {quote.number}
            <Badge tone={QUOTE_STATUS_TONES[quote.status]}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
          </span>
        }
        description={`${formatBRL(quote.totalCents)} · válido até ${formatDate(quote.validUntil)}`}
      />

      <div className="space-y-4 px-5 py-4">
        {aguardando && (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted/50 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{quote.publicUrl}</span>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Copiar link" onClick={() => void copiar()}>
                {copiado ? <Check /> : <Copy />}
              </Button>
            </div>
            {canSend && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void enviarWhatsApp()} loading={share.isPending}>
                  <MessageCircle />
                  Enviar pelo WhatsApp
                </Button>
                {canRecord && (
                  <Button variant="secondary" onClick={() => setDeciding(true)}>
                    Registrar resposta
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2 text-muted">
            <Eye className="size-3.5" aria-hidden="true" />
            {quote.viewCount === 0 ? (
              <span>O cliente ainda não abriu o link.</span>
            ) : (
              <span>
                Visto {quote.viewCount === 1 ? '1 vez' : `${quote.viewCount} vezes`}
                {quote.lastViewedAt && ` · ${formatRelative(quote.lastViewedAt)}`}
              </span>
            )}
          </div>
          {quote.decision && (
            <div className="rounded-lg bg-surface-muted/60 p-3">
              <p className="font-medium">
                {APPROVAL_DECISION_LABELS[quote.decision.decision]} · {APPROVAL_CHANNEL_LABELS[quote.decision.channel]}
              </p>
              <p className="text-xs text-muted">
                {[
                  formatDateTime(quote.decision.decidedAt),
                  quote.decision.signerName,
                  quote.decision.recordedByName && `registrado por ${quote.decision.recordedByName}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {quote.approvedTotalCents !== null && quote.decision.decision !== 'REJECTED' && (
                <p className="mt-1 text-sm font-medium">Aprovado: {formatBRL(quote.approvedTotalCents)}</p>
              )}
              {quote.decision.rejectionReason && (
                <p className="mt-1 text-sm">Motivo: {quote.decision.rejectionReason}</p>
              )}
            </div>
          )}
        </dl>

        {!aguardando && canSend && order.items.some((item) => item.approvalStatus === 'DRAFT') && (
          <Button variant="secondary" onClick={() => setSending(true)}>
            <Send />
            Enviar orçamento complementar
          </Button>
        )}
      </div>

      <SendQuoteDialog order={order} open={sending} onOpenChange={setSending} />
      <ManualDecisionDialog quote={quote} order={order} open={deciding} onOpenChange={setDeciding} />
    </Card>
  );
}
