import type { PublicQuote } from '@oficinaos/shared';
import { useEffect, useState } from 'react';
import { formatBRL, formatDate, formatPhone, formatPlate } from './format';
import { approveQuote, askQuestion, loadQuote, rejectQuote, type QuoteError } from './quote-api';

type Screen = 'carregando' | 'erro' | 'orcamento';
type Sheet = null | 'aprovar' | 'recusar' | 'pergunta';

export function QuotePage({ token }: { token: string }) {
  const [screen, setScreen] = useState<Screen>('carregando');
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [error, setError] = useState<QuoteError | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);

  useEffect(() => {
    let cancelado = false;
    loadQuote(token)
      .then((result) => {
        if (cancelado) return;
        // versão substituída: o link antigo leva à nova, sem o cliente fazer nada
        if ('redirectToken' in result) {
          window.location.replace(`/orcamento/${result.redirectToken}`);
          return;
        }
        setQuote(result.quote);
        setSelected(result.quote.items.map((item) => item.id));
        setScreen('orcamento');
      })
      .catch((err: QuoteError) => {
        if (cancelado) return;
        setError(err);
        setScreen('erro');
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  if (screen === 'carregando') {
    return <Centro>Carregando o orçamento…</Centro>;
  }
  if (screen === 'erro' || !quote) {
    return (
      <Centro>
        <p className="text-lg font-semibold">{error?.title ?? 'Orçamento não encontrado'}</p>
        <p className="mt-1 text-neutral-600">{error?.detail ?? 'Confira o link que a oficina enviou.'}</p>
      </Centro>
    );
  }

  const decidido = quote.decision !== null;
  const expirado = quote.status === 'EXPIRED';
  const revogado = quote.status === 'REVOKED';
  const podeResponder = !decidido && !expirado && !revogado;

  const total = quote.items
    .filter((item) => selected.includes(item.id))
    .reduce((soma, item) => soma + item.totalCents, 0);

  const necessarios = quote.items.filter((item) => !item.isOptional);
  const recomendados = quote.items.filter((item) => item.isOptional);

  return (
    /* a folga embaixo cabe a barra fixa INTEIRA (total + 3 botões): sem isso o
       resumo de valores fica escondido justamente na hora de decidir */
    <div className={`min-h-dvh bg-neutral-50 text-neutral-900 ${podeResponder ? 'pb-56' : 'pb-12'}`}>
      <header className="bg-white px-5 py-4 shadow-sm">
        <p className="text-lg font-bold">{quote.shop.name}</p>
        {formatPhone(quote.shop.whatsapp ?? quote.shop.phone) && (
          <p className="text-sm text-neutral-600">{formatPhone(quote.shop.whatsapp ?? quote.shop.phone)}</p>
        )}
      </header>

      <main className="mx-auto max-w-xl px-5">
        <section className="pt-6">
          <h1 className="text-2xl font-bold">Orçamento para seu veículo</h1>
          <p className="mt-1 text-neutral-600">
            Olá, {quote.customerFirstName}. Orçamento nº {quote.number} · válido até {formatDate(quote.validUntil)}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow-sm">
            {quote.vehicle.plate && <Placa plate={quote.vehicle.plate} />}
            <div>
              <p className="font-semibold">
                {quote.vehicle.make} {quote.vehicle.model} {quote.vehicle.version ?? ''}
              </p>
              {quote.vehicle.yearLabel && <p className="text-sm text-neutral-600">{quote.vehicle.yearLabel}</p>}
            </div>
          </div>
        </section>

        {quote.message && (
          <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm whitespace-pre-line text-amber-900">{quote.message}</p>
        )}

        {decidido && <Resultado quote={quote} />}
        {expirado && (
          <Aviso titulo="Este orçamento venceu">
            Peça um novo à oficina — os preços podem ter mudado desde {formatDate(quote.validUntil)}.
          </Aviso>
        )}
        {revogado && <Aviso titulo="Este orçamento foi cancelado pela oficina">Fale com a oficina para receber um novo.</Aviso>}

        {necessarios.length > 0 && (
          <Grupo titulo="Necessários" descricao="O que precisa ser feito para o veículo ficar seguro.">
            {necessarios.map((item) => (
              <Item key={item.id} item={item} selecionavel={false} selecionado onToggle={() => undefined} />
            ))}
          </Grupo>
        )}

        {recomendados.length > 0 && (
          <Grupo titulo="Recomendados" descricao="Pode deixar para depois. Desmarque o que não quiser agora.">
            {recomendados.map((item) => (
              <Item
                key={item.id}
                item={item}
                selecionavel={podeResponder}
                selecionado={selected.includes(item.id)}
                onToggle={() =>
                  setSelected((atual) =>
                    atual.includes(item.id) ? atual.filter((id) => id !== item.id) : [...atual, item.id],
                  )
                }
              />
            ))}
          </Grupo>
        )}

        <section className="mt-6 rounded-xl bg-white p-4 shadow-sm">
          <Linha rotulo="Itens selecionados" valor={formatBRL(total)} />
          {quote.discountCents > 0 && <Linha rotulo="Desconto" valor={`− ${formatBRL(quote.discountCents)}`} />}
          <div className="mt-2 flex justify-between border-t border-neutral-200 pt-2 text-lg font-bold">
            <span>Total</span>
            <span>{formatBRL(Math.max(0, total - quote.discountCents))}</span>
          </div>
        </section>

        {podeResponder && (
          <p className="mt-6 text-center text-xs text-neutral-500">
            Ao aprovar, você autoriza a execução dos serviços marcados. A oficina guarda o registro da sua resposta.
          </p>
        )}
      </main>

      {podeResponder && (
        <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white p-4 shadow-lg">
          <div className="mx-auto max-w-xl">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-sm text-neutral-600">
                {selected.length} {selected.length === 1 ? 'item' : 'itens'}
              </span>
              <span className="text-xl font-bold">{formatBRL(Math.max(0, total - quote.discountCents))}</span>
            </div>
            <button
              type="button"
              onClick={() => setSheet('aprovar')}
              disabled={!selected.length}
              className="w-full rounded-xl bg-emerald-600 px-5 py-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              Aprovar orçamento
            </button>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setSheet('recusar')} className="flex-1 rounded-xl border border-neutral-300 px-4 py-3 font-medium">
                Recusar
              </button>
              <button type="button" onClick={() => setSheet('pergunta')} className="flex-1 rounded-xl border border-neutral-300 px-4 py-3 font-medium">
                Fazer pergunta
              </button>
            </div>
          </div>
        </div>
      )}

      {sheet && (
        <Folha onClose={() => setSheet(null)}>
          {sheet === 'aprovar' && (
            <Confirmacao
              quote={quote}
              selected={selected}
              total={Math.max(0, total - quote.discountCents)}
              token={token}
              onDone={setQuote}
              onClose={() => setSheet(null)}
            />
          )}
          {sheet === 'recusar' && <Recusa quote={quote} token={token} onDone={setQuote} onClose={() => setSheet(null)} />}
          {sheet === 'pergunta' && <Pergunta token={token} onClose={() => setSheet(null)} />}
        </Folha>
      )}
    </div>
  );
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-neutral-50 px-6 text-center text-neutral-700">{children}</div>;
}

function Placa({ plate }: { plate: string }) {
  return (
    <span className="rounded-md border-2 border-blue-800 bg-white px-2 py-1 font-mono text-sm font-bold tracking-wider">
      {formatPlate(plate)}
    </span>
  );
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl bg-neutral-200 p-4">
      <p className="font-semibold">{titulo}</p>
      <p className="mt-1 text-sm text-neutral-700">{children}</p>
    </div>
  );
}

function Resultado({ quote }: { quote: PublicQuote }) {
  const decision = quote.decision!;
  const recusado = decision.decision === 'REJECTED';
  return (
    <div className={`mt-4 rounded-xl p-4 ${recusado ? 'bg-neutral-200' : 'bg-emerald-50'}`}>
      <p className="font-semibold">
        {recusado
          ? 'Você recusou este orçamento'
          : decision.decision === 'APPROVED'
            ? 'Orçamento aprovado. Obrigado!'
            : 'Você aprovou parte dos itens. Obrigado!'}
      </p>
      <p className="mt-1 text-sm text-neutral-700">
        {formatDate(decision.decidedAt)}
        {decision.signerName && ` · ${decision.signerName}`}
        {!recusado && ` · ${formatBRL(decision.approvedTotalCents)}`}
      </p>
    </div>
  );
}

function Grupo({ titulo, descricao, children }: { titulo: string; descricao: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="font-bold">{titulo}</h2>
      <p className="mb-2 text-sm text-neutral-600">{descricao}</p>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Item({ item, selecionavel, selecionado, onToggle }: {
  item: PublicQuote['items'][number];
  selecionavel: boolean;
  selecionado: boolean;
  onToggle(): void;
}) {
  return (
    <li className={`rounded-xl bg-white p-4 shadow-sm ${selecionado ? '' : 'opacity-60'}`}>
      <label className="flex items-start gap-3">
        {selecionavel && (
          <input type="checkbox" checked={selecionado} onChange={onToggle} className="mt-1 size-5 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex justify-between gap-3 font-medium">
            <span>{item.description}</span>
            <span className="whitespace-nowrap">{formatBRL(item.totalCents)}</span>
          </span>
          <span className="block text-sm text-neutral-600">
            {item.quantity > 1 && `${item.quantity} × ${formatBRL(item.unitPriceCents)}`}
            {item.brand && ` · ${item.brand}`}
          </span>
        </span>
      </label>
      {item.photos.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-sm font-medium">Identificamos este problema no seu veículo:</p>
          <div className="flex gap-2 overflow-x-auto">
            {item.photos.map((photo) => (
              <img
                key={photo.id}
                src={photo.url}
                alt={photo.caption ?? 'Foto do serviço'}
                loading="lazy"
                className="h-28 w-28 shrink-0 rounded-lg object-cover"
              />
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between text-sm text-neutral-700">
      <span>{rotulo}</span>
      <span>{valor}</span>
    </div>
  );
}

function Folha({ children, onClose }: { children: React.ReactNode; onClose(): void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full rounded-t-2xl bg-white p-5" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** Confirmação explícita: resumo, nome e aceite. Nada pré-marcado (§8.2). */
function Confirmacao({ quote, selected, total, token, onDone, onClose }: {
  quote: PublicQuote;
  selected: string[];
  total: number;
  token: string;
  onDone(quote: PublicQuote): void;
  onClose(): void;
}) {
  const [nome, setNome] = useState('');
  const [aceite, setAceite] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      onDone(await approveQuote(token, { approvedItemIds: selected, signerName: nome.trim(), contentHash: quote.contentHash }));
      onClose();
    } catch (err) {
      setErro((err as QuoteError).detail);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold">Confirmar aprovação</h2>
      <p className="mt-1 text-neutral-700">
        Você está aprovando {selected.length} {selected.length === 1 ? 'item' : 'itens'}, total de {formatBRL(total)}.
      </p>
      {erro && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      <label className="mt-4 block text-sm font-medium">
        Seu nome
        <input
          value={nome}
          onChange={(event) => setNome(event.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-3 text-base"
          placeholder="Como a oficina te chama"
          autoFocus
        />
      </label>
      <label className="mt-4 flex items-start gap-3 text-sm">
        <input type="checkbox" checked={aceite} onChange={(event) => setAceite(event.target.checked)} className="mt-0.5 size-5" />
        <span>Autorizo a execução dos serviços descritos neste orçamento.</span>
      </label>
      <button
        type="button"
        onClick={() => void confirmar()}
        disabled={nome.trim().length < 2 || !aceite || enviando}
        className="mt-5 w-full rounded-xl bg-emerald-600 px-5 py-4 text-lg font-semibold text-white disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Confirmar aprovação'}
      </button>
      <button type="button" onClick={onClose} className="mt-2 w-full rounded-xl px-5 py-3 font-medium text-neutral-600">
        Voltar
      </button>
    </div>
  );
}

function Recusa({ quote, token, onDone, onClose }: {
  quote: PublicQuote;
  token: string;
  onDone(quote: PublicQuote): void;
  onClose(): void;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div>
      <h2 className="text-lg font-bold">Recusar o orçamento</h2>
      <p className="mt-1 text-neutral-700">Se quiser, conte o motivo — ajuda a oficina a te fazer uma proposta melhor.</p>
      {erro && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      <textarea
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        rows={3}
        className="mt-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base"
        placeholder="Ex.: vou fazer mês que vem"
      />
      <button
        type="button"
        disabled={enviando}
        onClick={() => {
          setEnviando(true);
          setErro(null);
          rejectQuote(token, { reason: motivo.trim(), contentHash: quote.contentHash })
            .then((atualizado) => {
              onDone(atualizado);
              onClose();
            })
            .catch((err: QuoteError) => setErro(err.detail))
            .finally(() => setEnviando(false));
        }}
        className="mt-4 w-full rounded-xl border border-neutral-300 px-5 py-4 font-semibold"
      >
        {enviando ? 'Enviando…' : 'Confirmar recusa'}
      </button>
      <button type="button" onClick={onClose} className="mt-2 w-full rounded-xl px-5 py-3 font-medium text-neutral-600">
        Voltar
      </button>
    </div>
  );
}

function Pergunta({ token, onClose }: { token: string; onClose(): void }) {
  const [mensagem, setMensagem] = useState('');
  const [enviada, setEnviada] = useState(false);
  const [enviando, setEnviando] = useState(false);

  if (enviada) {
    return (
      <div>
        <h2 className="text-lg font-bold">Pergunta enviada</h2>
        <p className="mt-1 text-neutral-700">A oficina foi avisada e vai te responder.</p>
        <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-neutral-900 px-5 py-4 font-semibold text-white">
          Fechar
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-bold">Fazer uma pergunta</h2>
      <textarea
        value={mensagem}
        onChange={(event) => setMensagem(event.target.value)}
        rows={3}
        autoFocus
        className="mt-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base"
        placeholder="Ex.: dá para fazer só o freio agora?"
      />
      <button
        type="button"
        disabled={mensagem.trim().length < 3 || enviando}
        onClick={() => {
          setEnviando(true);
          askQuestion(token, mensagem.trim())
            .then(() => setEnviada(true))
            .finally(() => setEnviando(false));
        }}
        className="mt-4 w-full rounded-xl bg-neutral-900 px-5 py-4 font-semibold text-white disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Enviar pergunta'}
      </button>
      <button type="button" onClick={onClose} className="mt-2 w-full rounded-xl px-5 py-3 font-medium text-neutral-600">
        Voltar
      </button>
    </div>
  );
}
