import {
  formatBRL,
  formatBRLInput,
  parseBRL,
  OFFER_BADGE_ICONS,
  OFFER_BADGE_LABELS,
  PART_OFFER_AVAILABILITY_LABELS,
  PART_OFFER_AVAILABILITY_TONES,
  PART_SEARCH_PROVIDER_HINTS,
  PART_SEARCH_PROVIDER_LABELS,
  type PartOffer,
  type PartSearchResult,
} from '@oficinaos/shared';
import { PackageSearch, Search, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { AdornedInput, Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { EmptyState } from '../../components/ui/list-parts';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useAddOfferToWorkOrder, useSearchParts } from './api';
import { useWorkOrder } from '../work-orders/api';

/**
 * Pesquisa de peças e comparador (E14).
 *
 * A tela responde à pergunta do balcão: **onde eu arrumo esta peça, por quanto
 * e em quanto tempo**. As fontes aparecem com nome ("estoque", "lista da
 * Central", "cotação respondida") e a hora da consulta, porque preço de peça
 * envelhece. A regra de cada selo está escrita embaixo da lista — comparador
 * que a oficina não entende, a oficina não usa.
 */
export function PartsSearchPage() {
  const [params, setParams] = useSearchParams();
  const numeroDaOs = params.get('os');
  // `useWorkOrder` já ignora número inválido: sem `?os=` na URL, não busca nada
  const os = useWorkOrder(Number(numeroDaOs));
  const [texto, setTexto] = useState(params.get('q') ?? '');
  const buscar = useSearchParts();
  const [resultado, setResultado] = useState<PartSearchResult | null>(null);
  const [escolhida, setEscolhida] = useState<PartOffer | null>(null);

  async function pesquisar(termo: string) {
    const limpo = termo.trim();
    if (limpo.length < 2) return;
    const proximo = new URLSearchParams(params);
    proximo.set('q', limpo);
    setParams(proximo, { replace: true });
    try {
      setResultado(await buscar.mutateAsync({ q: limpo, vehicleId: os.data?.vehicle.id ?? null, providers: [] }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const indisponiveis = (resultado?.providers ?? []).filter((provider) => !provider.ok);

  return (
    <>
      <PageHeader
        title="Pesquisar peças"
        description="Compara o que você já tem na prateleira com a lista dos fornecedores e as cotações respondidas."
        actions={
          os.data ? (
            <Badge tone="accent">
              Adicionando à OS nº {os.data.number} · {os.data.vehicle.make} {os.data.vehicle.model}
            </Badge>
          ) : undefined
        }
      />

      <Card>
        <form
          className="flex flex-wrap gap-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void pesquisar(texto);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              aria-label="O que você procura"
              className="pl-9"
              placeholder="Pastilha de freio, PF-100, correia dentada…"
              value={texto}
              autoFocus
              onChange={(event) => setTexto(event.target.value)}
            />
          </div>
          <Button type="submit" loading={buscar.isPending} disabled={texto.trim().length < 2}>
            Pesquisar
          </Button>
        </form>
      </Card>

      {buscar.isPending && (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {resultado && !buscar.isPending && (
        <div className="mt-4 space-y-4">
          {indisponiveis.length > 0 && (
            <Alert variant="warning">
              {indisponiveis.map((provider) => provider.message).join(' ')} O resto da busca continua valendo.
            </Alert>
          )}

          {!resultado.offers.length ? (
            <Card>
              <EmptyState
                icon={PackageSearch}
                title="Nenhuma oferta para esse termo"
                description="Tente o código do fabricante, ou importe a lista de preço do fornecedor no cadastro dele."
              />
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader
                  title={`${resultado.offers.length} ${resultado.offers.length === 1 ? 'oferta' : 'ofertas'} para "${resultado.query}"`}
                  description={`Preço sugerido de venda com a margem de ${(resultado.markupBps / 100).toLocaleString('pt-BR')}% da oficina.`}
                />
                <ul className="divide-y divide-border">
                  {resultado.offers.map((oferta) => (
                    <li key={oferta.id} className="px-5 py-4">
                      <Oferta oferta={oferta} onEscolher={os.data ? () => setEscolhida(oferta) : undefined} />
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <CardHeader title="Como os selos são calculados" />
                <dl className="space-y-2 px-5 py-4 text-sm">
                  <div>
                    <dt className="font-medium">{OFFER_BADGE_ICONS.best_price} {OFFER_BADGE_LABELS.best_price}</dt>
                    <dd className="text-muted">Menor preço + frete. Empate vai para quem entrega antes.</dd>
                  </div>
                  <div>
                    <dt className="font-medium">{OFFER_BADGE_ICONS.fastest} {OFFER_BADGE_LABELS.fastest}</dt>
                    <dd className="text-muted">Menor prazo. O que está no estoque tem prazo zero.</dd>
                  </div>
                  <div>
                    <dt className="font-medium">{OFFER_BADGE_ICONS.best_value} {OFFER_BADGE_LABELS.best_value}</dt>
                    <dd className="text-muted">
                      Preço + frete, com cada dia de espera contando como 2% do preço — o carro parado no elevador
                      também custa. Sem prazo informado, conta como uma semana.
                    </dd>
                  </div>
                </dl>
              </Card>

              <p className="text-xs text-muted">
                Fontes consultadas:{' '}
                {resultado.providers
                  .map((provider) => `${PART_SEARCH_PROVIDER_LABELS[provider.provider]} (${provider.count})`)
                  .join(' · ')}
                . {PART_SEARCH_PROVIDER_HINTS.price_list}
              </p>
            </>
          )}
        </div>
      )}

      {!resultado && !buscar.isPending && (
        <Card className="mt-4">
          <EmptyState
            icon={PackageSearch}
            title="Procure pelo nome ou pelo código"
            description="A busca olha o seu estoque, as listas de preço importadas dos fornecedores e o que eles já responderam nas cotações."
          />
        </Card>
      )}

      <AdicionarDialog
        oferta={escolhida}
        workOrderId={os.data?.id ?? null}
        workOrderNumber={os.data?.number ?? null}
        onClose={() => setEscolhida(null)}
      />
    </>
  );
}

function Oferta({ oferta, onEscolher }: { oferta: PartOffer; onEscolher?: () => void }) {
  const fonte = PART_SEARCH_PROVIDER_LABELS[oferta.provider];
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {oferta.badges.map((badge) => (
            <Badge key={badge} tone={badge === 'best_price' ? 'success' : badge === 'fastest' ? 'info' : 'accent'}>
              {OFFER_BADGE_ICONS[badge]} {OFFER_BADGE_LABELS[badge]}
            </Badge>
          ))}
          {oferta.isMock && (
            <Badge tone="warning">
              <TriangleAlert className="size-3" aria-hidden="true" /> Dados de demonstração
            </Badge>
          )}
        </div>
        <p className="mt-1 font-medium">
          {oferta.partId ? (
            <Link className="underline-offset-2 hover:underline" to={`/pecas/${oferta.partId}`}>
              {oferta.title}
            </Link>
          ) : (
            oferta.title
          )}
        </p>
        <p className="text-xs text-muted">
          {[
            oferta.brand,
            oferta.code,
            oferta.supplierName ?? fonte,
            oferta.availableQuantity !== null ? `${oferta.availableQuantity} em estoque` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone={PART_OFFER_AVAILABILITY_TONES[oferta.availability]}>
            {PART_OFFER_AVAILABILITY_LABELS[oferta.availability]}
          </Badge>
          <span>
            {/* fornecedor com prazo zero entrega no mesmo dia; "na prateleira" é só do estoque */}
            {oferta.availability === 'IN_STOCK'
              ? 'na prateleira'
              : oferta.leadTimeDays === null
                ? 'prazo não informado'
                : oferta.leadTimeDays === 0
                  ? 'entrega no mesmo dia'
                  : `${oferta.leadTimeDays} ${oferta.leadTimeDays === 1 ? 'dia' : 'dias'}`}
          </span>
          <span>consultado em {formatDateTime(oferta.fetchedAt)}</span>
        </p>
      </div>

      <div className="text-right">
        <p className="text-lg font-semibold tabular">{formatBRL(oferta.totalCents)}</p>
        <p className="text-xs text-muted tabular">
          {oferta.shippingCents > 0 ? `${formatBRL(oferta.priceCents)} + ${formatBRL(oferta.shippingCents)} de frete` : 'sem frete'}
        </p>
        {oferta.priceGapCents > 0 && (
          <p className="text-xs text-danger tabular">+{formatBRL(oferta.priceGapCents)} que a mais barata</p>
        )}
        <p className="mt-1 text-xs text-muted">
          cobrar <span className="font-medium text-foreground tabular">{formatBRL(oferta.suggestedPriceCents)}</span>
        </p>
        {onEscolher && oferta.availability !== 'UNAVAILABLE' && (
          <Button className="mt-2" size="sm" variant="secondary" onClick={onEscolher}>
            Adicionar à OS
          </Button>
        )}
      </div>
    </div>
  );
}

function AdicionarDialog({ oferta, workOrderId, workOrderNumber, onClose }: {
  oferta: PartOffer | null;
  workOrderId: string | null;
  workOrderNumber: number | null;
  onClose(): void;
}) {
  const adicionar = useAddOfferToWorkOrder();
  const [quantidade, setQuantidade] = useState('1');
  const [preco, setPreco] = useState('');
  const [recomendado, setRecomendado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const aberto = Boolean(oferta && workOrderId);
  const sugerido = oferta?.suggestedPriceCents ?? 0;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        if (!proximo) {
          setErro(null);
          setPreco('');
          setQuantidade('1');
          setRecomendado(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Adicionar à OS"
          description={oferta ? `${oferta.title} · custo ${formatBRL(oferta.totalCents)}` : undefined}
        />
        <div className="space-y-4">
          {erro && <Alert variant="danger">{erro}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantidade" htmlFor="oferta-quantidade">
              <Input
                {...fieldA11y('oferta-quantidade')}
                inputMode="decimal"
                value={quantidade}
                onChange={(event) => setQuantidade(event.target.value.replace(/[^\d,.]/g, ''))}
              />
            </Field>
            <Field
              label="Preço de venda"
              htmlFor="oferta-preco"
              hint={`Sugerido pela margem: ${formatBRL(sugerido)}`}
            >
              <AdornedInput
                {...fieldA11y('oferta-preco', undefined, true)}
                leading="R$"
                inputMode="numeric"
                placeholder={formatBRLInput(sugerido)}
                value={preco}
                onChange={(event) => setPreco(formatBRLInput(parseBRL(event.target.value) ?? 0))}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-border"
              checked={recomendado}
              onChange={(event) => setRecomendado(event.target.checked)}
            />
            Item recomendado (o cliente pode desmarcar no orçamento)
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={adicionar.isPending}
            onClick={async () => {
              if (!oferta || !workOrderId) return;
              setErro(null);
              const quantidadeNumero = Number(quantidade.replace(',', '.'));
              if (!Number.isFinite(quantidadeNumero) || quantidadeNumero <= 0) {
                setErro('Informe uma quantidade válida.');
                return;
              }
              try {
                await adicionar.mutateAsync({
                  offerId: oferta.id,
                  workOrderId,
                  quantity: quantidadeNumero,
                  unitPriceCents: preco ? (parseBRL(preco) ?? null) : null,
                  isOptional: recomendado,
                });
                toast.success(`Peça adicionada à OS nº ${workOrderNumber}.`);
                onClose();
              } catch (err) {
                setErro(errorMessage(err));
              }
            }}
          >
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
