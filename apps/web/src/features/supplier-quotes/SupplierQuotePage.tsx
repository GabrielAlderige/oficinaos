import {
  formatBRL,
  formatPercentInput,
  formatQuantity,
  OFFER_AVAILABILITY_LABELS,
  suggestedSalePrice,
  type IssuedSupplierLink,
  type OfferAvailability,
  type SupplierQuote,
} from '@oficinaos/shared';
import { Ban, EyeOff, Link2, Trophy, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { usePageCrumb } from '../../app/layouts/crumbs';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field } from '../../components/ui/field';
import { Textarea } from '../../components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useAwardSupplierQuote, useCancelSupplierQuote, useReissueSupplierLink, useSupplierQuote } from './api';
import { SupplierLinks } from './SupplierLinks';
import { SupplierQuoteStatusBadge } from './SupplierQuotesCard';

export function SupplierQuotePage() {
  const { number = '', id = '' } = useParams();
  const cotacao = useSupplierQuote(id);
  usePageCrumb(cotacao.data ? `Cotação nº ${cotacao.data.number}` : undefined);
  usePageCrumb(`OS ${number}`, `/ordens/${number}`);

  if (cotacao.isPending) {
    return (
      <div className="space-y-4" aria-label="Carregando cotação">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (cotacao.isError) {
    return (
      <Alert variant="danger">
        {errorMessage(cotacao.error)}{' '}
        <Link to={`/ordens/${number}`} className="font-medium underline">
          Voltar para a OS
        </Link>
      </Alert>
    );
  }
  return <Quadro cotacao={cotacao.data} />;
}

type Convite = SupplierQuote['invites'][number];
type Oferta = NonNullable<Convite['response']>['items'][number];

const ofertaValida = (oferta: Oferta) => oferta.availability !== 'UNAVAILABLE' && oferta.unitPriceCents !== null;

const TONS: Record<OfferAvailability, 'success' | 'info' | 'neutral'> = {
  AVAILABLE: 'success',
  TO_ORDER: 'info',
  UNAVAILABLE: 'neutral',
};

const prazoEmDias = (dias: number | null) =>
  dias === null ? null : dias === 0 ? 'entrega hoje' : `${dias} ${dias === 1 ? 'dia' : 'dias'}`;

/**
 * O quadro da cotação: quem respondeu, a comparação peça a peça e a escolha.
 * Preço de fornecedor é custo — com `pricesHidden` a API manda tudo vazio e a
 * tela diz isso, em vez de mostrar zeros.
 */
function Quadro({ cotacao }: { cotacao: SupplierQuote }) {
  const podeEnviar = useCan('supplier_quotes:send');
  const podeEscolher = useCan('supplier_quotes:award');
  const award = useAwardSupplierQuote(cotacao.id);
  const [cancelando, setCancelando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const escolhaSalva = new Map(cotacao.items.flatMap((item) => (item.award ? [[item.id, item.award.responseItemId] as const] : [])));
  const [escolha, setEscolha] = useState<ReadonlyMap<string, string>>(escolhaSalva);
  const mudou = [...escolha].filter(([itemId, ofertaId]) => escolhaSalva.get(itemId) !== ofertaId);

  const aberta = cotacao.status === 'OPEN' && !cotacao.expired;
  const cancelada = cotacao.status === 'CANCELED';
  const escolhendo = podeEscolher && !cancelada && !cotacao.pricesHidden;
  const respondidos = cotacao.invites.filter((convite) => convite.response);
  const nomeDe = new Map(cotacao.invites.map((convite) => [convite.supplier.id, convite.supplier.name]));

  async function salvarEscolha() {
    try {
      await award.mutateAsync(mudou.map(([requestItemId, responseItemId]) => ({ requestItemId, responseItemId })));
      toast.success('Escolha salva.');
    } catch (err) {
      toast.error(errorMessage(err));
      setEscolha(escolhaSalva);
    }
  }

  const carro = cotacao.vehicle
    ? [cotacao.vehicle.make, cotacao.vehicle.model, cotacao.vehicle.version, cotacao.vehicle.year].filter(Boolean).join(' ')
    : null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Cotação nº {cotacao.number}
            <SupplierQuoteStatusBadge status={cotacao.status} expired={cotacao.expired} />
          </span>
        }
        description={[
          cotacao.workOrder && `OS ${cotacao.workOrder.number}`,
          carro,
          `criada ${formatRelative(cotacao.createdAt)}${cotacao.createdByName ? ` por ${cotacao.createdByName}` : ''}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          podeEnviar &&
          !cancelada && (
            <Button variant="secondary" onClick={() => setCancelando(true)}>
              <Ban />
              Cancelar cotação
            </Button>
          )
        }
      />

      <div className="mb-6 space-y-3">
        {cotacao.pricesHidden && (
          <Alert variant="info">
            Preço de fornecedor é custo da oficina: só quem vê custo enxerga os valores. Aqui você acompanha quem abriu e
            quem respondeu.
          </Alert>
        )}
        {cancelada && (
          <Alert variant="danger">
            Cancelada {cotacao.canceledAt ? `em ${formatDateTime(cotacao.canceledAt)}` : ''}
            {cotacao.cancelReason ? ` — ${cotacao.cancelReason}` : ''}. Os links não aceitam mais resposta.
          </Alert>
        )}
        {cotacao.status === 'CLOSED' && (
          <Alert variant="success">
            Encerrada {cotacao.closedAt ? `em ${formatDateTime(cotacao.closedAt)}` : ''}: os fornecedores não podem mais
            responder nem corrigir. A escolha ainda pode ser trocada.
          </Alert>
        )}
        {cotacao.status === 'OPEN' && cotacao.expired && (
          <Alert variant="warning">O prazo acabou: os links não aceitam mais resposta, mas dá para escolher entre as que chegaram.</Alert>
        )}
        {aberta && (
          <p className="text-sm text-muted">
            Aceita resposta até {formatDateTime(cotacao.expiresAt)} ({formatRelative(cotacao.expiresAt)}). O quadro se atualiza
            sozinho.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {cotacao.items.map((item) => {
            const ofertas = respondidos.flatMap((convite) => {
              const oferta = convite.response!.items.find((linha) => linha.requestItemId === item.id);
              return oferta ? [{ convite, oferta }] : [];
            });
            // o que tem primeiro, e dentro disso o mais barato
            ofertas.sort(
              (a, b) =>
                Number(ofertaValida(b.oferta)) - Number(ofertaValida(a.oferta)) ||
                (a.oferta.unitPriceCents ?? 0) - (b.oferta.unitPriceCents ?? 0),
            );
            return (
              <Card key={item.id}>
                <CardHeader
                  title={item.description}
                  description={[
                    `${formatQuantity(Math.round(item.quantity * 1000))} ${item.unit.toLowerCase()}`,
                    item.partCode,
                    item.brand,
                    item.award && `escolhida: ${nomeDe.get(item.award.supplierId) ?? 'fornecedor'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
                {ofertas.length === 0 ? (
                  <p className="px-5 py-5 text-sm text-muted">Nenhuma resposta para esta peça ainda.</p>
                ) : (
                  <fieldset>
                    <legend className="sr-only">Ofertas para {item.description}</legend>
                    <ul className="divide-y divide-border">
                      {ofertas.map(({ convite, oferta }) => {
                        const valida = ofertaValida(oferta);
                        const marcada = escolha.get(item.id) === oferta.id;
                        const salva = escolhaSalva.get(item.id) === oferta.id;
                        return (
                          <li key={oferta.id}>
                            <label
                              className={cn(
                                'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-5 py-3',
                                escolhendo && valida && 'cursor-pointer hover:bg-surface-muted/50',
                                marcada && 'bg-accent-soft/40',
                              )}
                            >
                              {escolhendo ? (
                                <input
                                  type="radio"
                                  className="mt-1 size-4"
                                  name={`escolha-${item.id}`}
                                  disabled={!valida}
                                  checked={marcada}
                                  onChange={() => setEscolha((atual) => new Map(atual).set(item.id, oferta.id))}
                                  aria-label={`Escolher ${convite.supplier.name} para ${item.description}`}
                                />
                              ) : (
                                <span className="size-4" aria-hidden="true" />
                              )}
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="truncate text-sm font-medium">{convite.supplier.name}</span>
                                  <Badge tone={TONS[oferta.availability]}>{OFFER_AVAILABILITY_LABELS[oferta.availability]}</Badge>
                                  {salva && (
                                    <Badge tone="accent">
                                      <Trophy className="size-3" aria-hidden="true" />
                                      Escolhida
                                    </Badge>
                                  )}
                                  {item.cheapestResponseItemId === oferta.id && <Badge tone="success">Mais barata</Badge>}
                                  {item.fastestResponseItemId === oferta.id && (
                                    <Badge tone="info">
                                      <Zap className="size-3" aria-hidden="true" />
                                      Mais rápida
                                    </Badge>
                                  )}
                                </span>
                                <span className="block text-xs text-muted">
                                  {[oferta.brand && `marca ${oferta.brand}`, valida && prazoEmDias(oferta.leadTimeDays), oferta.notes]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </span>
                              <span className="text-right text-sm tabular">
                                {!valida ? (
                                  <span className="text-muted">–</span>
                                ) : cotacao.pricesHidden ? (
                                  <EyeOff className="ml-auto size-4 text-muted" aria-label="Preço oculto" />
                                ) : (
                                  <>
                                    <span className="block font-medium">{formatBRL(oferta.unitPriceCents!)}</span>
                                    {item.quantity !== 1 && (
                                      <span className="block text-xs text-muted">
                                        {formatBRL(Math.round(oferta.unitPriceCents! * item.quantity))} no total
                                      </span>
                                    )}
                                  </>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                )}
                <SugestaoDePreco item={item} oferta={ofertas.find(({ oferta }) => oferta.id === escolha.get(item.id))?.oferta ?? null} />
              </Card>
            );
          })}
        </div>

        <div className="order-first space-y-6 lg:order-none">
          <FornecedoresCard cotacao={cotacao} podeReenviar={podeEnviar && aberta} />
        </div>
      </div>

      {escolhendo && mudou.length > 0 && (
        <div className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-3 shadow-lg">
          <span className="text-sm">
            {mudou.length} {mudou.length === 1 ? 'peça com escolha nova' : 'peças com escolha nova'}
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" onClick={() => setEscolha(escolhaSalva)}>
              Desfazer
            </Button>
            <Button loading={award.isPending} onClick={() => (cotacao.status === 'OPEN' ? setConfirmando(true) : void salvarEscolha())}>
              Salvar escolha
            </Button>
          </span>
        </div>
      )}

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="Escolher e encerrar a cotação?"
        description="Os fornecedores não poderão mais responder nem corrigir. O custo das peças que ainda não foram ao cliente passa a ser o da oferta escolhida; o preço de venda não muda sozinho."
        confirmLabel="Escolher e encerrar"
        onConfirm={salvarEscolha}
      />
      {cancelando && <CancelarDialog cotacao={cotacao} onClose={() => setCancelando(false)} />}
    </>
  );
}

/**
 * A escolha muda o custo, não o preço (decisão de 14/09/2026). A tela mostra a
 * conta da margem para quem vai decidir o preço de venda — e diz quando o item
 * já foi ao cliente e o custo não será mexido.
 */
function SugestaoDePreco({ item, oferta }: { item: SupplierQuote['items'][number]; oferta: Oferta | null }) {
  if (!item.pricing || !oferta || oferta.unitPriceCents === null) return null;
  const { markupBps, workOrderUnitPriceCents, workOrderItemDraft } = item.pricing;
  const sugerido = suggestedSalePrice(oferta.unitPriceCents, markupBps);
  return (
    <p className="border-t border-border px-5 py-3 text-xs text-muted">
      {workOrderItemDraft ? (
        <>
          Com a margem de {formatPercentInput(markupBps)}%, o preço sugerido é{' '}
          <span className="font-medium text-foreground tabular">{formatBRL(sugerido)}</span>
          {workOrderUnitPriceCents !== null && <> (hoje na OS: {formatBRL(workOrderUnitPriceCents)})</>}. O preço de venda não muda
          sozinho.
        </>
      ) : (
        'Este item já foi no orçamento para o cliente: o custo dele na OS não será alterado.'
      )}
    </p>
  );
}

function FornecedoresCard({ cotacao, podeReenviar }: { cotacao: SupplierQuote; podeReenviar: boolean }) {
  const reissue = useReissueSupplierLink(cotacao.id);
  const [reenviando, setReenviando] = useState<Convite | null>(null);
  const [novoLink, setNovoLink] = useState<IssuedSupplierLink | null>(null);
  const resumoDe = new Map(cotacao.summaries.map((resumo) => [resumo.supplierId, resumo]));

  return (
    <Card>
      <CardHeader
        title="Fornecedores"
        description={`${cotacao.invites.filter((c) => c.response).length} de ${cotacao.invites.length} responderam`}
      />
      <ul className="divide-y divide-border">
        {cotacao.invites.map((convite) => {
          const resumo = resumoDe.get(convite.supplier.id);
          return (
            <li key={convite.id} className="space-y-1 px-5 py-3">
              <p className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{convite.supplier.name}</span>
                {convite.response ? (
                  <Badge tone="success">Respondeu</Badge>
                ) : convite.viewCount > 0 ? (
                  <Badge tone="info">Abriu</Badge>
                ) : (
                  <Badge>Não abriu</Badge>
                )}
              </p>
              <p className="text-xs text-muted">
                {convite.response
                  ? [
                      `${convite.response.responderName}, ${formatRelative(convite.response.createdAt)}`,
                      convite.versions > 1 && `corrigiu ${convite.versions - 1} ${convite.versions === 2 ? 'vez' : 'vezes'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : convite.lastViewedAt
                    ? `Abriu ${convite.viewCount} ${convite.viewCount === 1 ? 'vez' : 'vezes'}, a última ${formatRelative(convite.lastViewedAt)}`
                    : `Link enviado ${formatRelative(convite.linkIssuedAt)}`}
              </p>
              {convite.response?.notes && <p className="text-xs whitespace-pre-line">“{convite.response.notes}”</p>}
              {resumo && (
                <p className="flex items-baseline justify-between gap-3 text-xs tabular">
                  <span className="text-muted">
                    {resumo.coveredItems} de {cotacao.items.length} {cotacao.items.length === 1 ? 'peça' : 'peças'} ·{' '}
                    {formatBRL(resumo.itemsTotalCents)}
                    {resumo.shippingCents > 0 && ` + frete ${formatBRL(resumo.shippingCents)}`}
                  </span>
                  <span className="text-sm font-medium whitespace-nowrap">{formatBRL(resumo.totalCents)}</span>
                </p>
              )}
              {podeReenviar && (
                <Button variant="link" size="sm" onClick={() => setReenviando(convite)}>
                  <Link2 />
                  Gerar link novo
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={reenviando !== null}
        onOpenChange={(open) => !open && setReenviando(null)}
        title={`Gerar link novo para ${reenviando?.supplier.name ?? 'o fornecedor'}?`}
        description="O link anterior deixa de funcionar na hora. Use quando o link se perdeu ou foi para o número errado. As respostas já enviadas continuam valendo."
        confirmLabel="Gerar link novo"
        onConfirm={async () => {
          if (!reenviando) return;
          try {
            setNovoLink(await reissue.mutateAsync(reenviando.id));
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
      <Dialog open={novoLink !== null} onOpenChange={(open) => !open && setNovoLink(null)}>
        <DialogContent>
          <DialogHeader title="Link novo" description="Mande para o fornecedor. O anterior já não abre mais." />
          {novoLink && <SupplierLinks links={[novoLink]} />}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNovoLink(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CancelarDialog({ cotacao, onClose }: { cotacao: SupplierQuote; onClose(): void }) {
  const cancel = useCancelSupplierQuote(cotacao.id);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function cancelar() {
    setErro(null);
    try {
      await cancel.mutateAsync(motivo);
      toast.success('Cotação cancelada.');
      onClose();
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={`Cancelar a cotação nº ${cotacao.number}?`}
          description="Os links param de aceitar resposta. O que já chegou fica registrado."
        />
        {erro && (
          <Alert variant="danger" className="mb-4">
            {erro}
          </Alert>
        )}
        <Field label="Motivo" htmlFor="rfq-cancel-reason">
          <Textarea id="rfq-cancel-reason" rows={2} value={motivo} onChange={(event) => setMotivo(event.target.value)} placeholder="Ex.: cliente desistiu do serviço" />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" disabled={motivo.trim().length < 3} loading={cancel.isPending} onClick={() => void cancelar()}>
            Cancelar cotação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
