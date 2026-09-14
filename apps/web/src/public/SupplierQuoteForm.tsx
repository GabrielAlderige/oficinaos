import type { OfferAvailability, PublicSupplierQuote } from '@oficinaos/shared';
import { useEffect, useState } from 'react';
import { formatBRL, formatCentsInput, formatDateTime, formatPhone, parseCents } from './format';
import { loadSupplierQuote, sendSupplierResponse, type SupplierQuoteError, type SupplierResponseBody } from './supplier-quote-api';

/**
 * A página que o fornecedor abre pelo link (E11). Uma peça por cartão, três
 * toques para dizer se tem, e o preço. Nada vem pré-marcado: "tenho" que o
 * balconista não escolheu seria oferta inventada no quadro da oficina.
 */

interface Linha {
  availability: OfferAvailability | null;
  preco: string;
  marca: string;
  prazo: string;
  obs: string;
}

const OPCOES: { valor: OfferAvailability; rotulo: string }[] = [
  { valor: 'AVAILABLE', rotulo: 'Tenho' },
  { valor: 'TO_ORDER', rotulo: 'Encomenda' },
  { valor: 'UNAVAILABLE', rotulo: 'Não tenho' },
];

const campo = 'mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-3 text-base';

function linhasDe(quote: PublicSupplierQuote): Record<string, Linha> {
  const anterior = new Map((quote.lastResponse?.items ?? []).map((item) => [item.requestItemId, item]));
  return Object.fromEntries(
    quote.items.map((item) => {
      const dele = anterior.get(item.id);
      return [
        item.id,
        {
          availability: dele?.availability ?? null,
          preco: dele?.unitPriceCents ? formatCentsInput(dele.unitPriceCents) : '',
          marca: dele?.brand ?? '',
          prazo: dele?.leadTimeDays === null || dele?.leadTimeDays === undefined ? '' : String(dele.leadTimeDays),
          obs: dele?.notes ?? '',
        },
      ];
    }),
  );
}

export function SupplierQuoteForm({ token }: { token: string }) {
  const [quote, setQuote] = useState<PublicSupplierQuote | null>(null);
  const [erroCarga, setErroCarga] = useState<SupplierQuoteError | null>(null);

  useEffect(() => {
    let cancelado = false;
    loadSupplierQuote(token)
      .then((carregada) => !cancelado && setQuote(carregada))
      .catch((err: SupplierQuoteError) => !cancelado && setErroCarga(err));
    return () => {
      cancelado = true;
    };
  }, [token]);

  if (erroCarga) {
    return (
      <Centro>
        <p className="text-lg font-semibold">
          {erroCarga.status === 404 ? 'Link de cotação inválido' : erroCarga.title}
        </p>
        <p className="mt-1 text-neutral-600">
          {erroCarga.status === 404
            ? 'Este link não existe ou foi substituído por um mais novo. Peça o link atualizado à oficina.'
            : erroCarga.detail}
        </p>
      </Centro>
    );
  }
  if (!quote) return <Centro>Carregando a cotação…</Centro>;
  return <Cotacao key={quote.lastResponse?.version ?? 0} token={token} inicial={quote} />;
}

function Cotacao({ token, inicial }: { token: string; inicial: PublicSupplierQuote }) {
  const [quote, setQuote] = useState(inicial);
  const [linhas, setLinhas] = useState(() => linhasDe(inicial));
  const [frete, setFrete] = useState(inicial.lastResponse?.shippingCents ? formatCentsInput(inicial.lastResponse.shippingCents) : '');
  const [obs, setObs] = useState(inicial.lastResponse?.notes ?? '');
  const [nome, setNome] = useState(inicial.lastResponse?.responderName ?? '');
  const [tentou, setTentou] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<SupplierQuoteError | null>(null);
  const [enviada, setEnviada] = useState(false);

  const mudar = (id: string, parte: Partial<Linha>) => {
    setEnviada(false);
    setLinhas((atual) => ({ ...atual, [id]: { ...atual[id]!, ...parte } }));
  };

  // o que falta em cada peça, em português — mostrado depois da primeira tentativa
  const problemas = Object.fromEntries(
    quote.items.map((item) => {
      const linha = linhas[item.id]!;
      if (!linha.availability) return [item.id, 'Diga se tem a peça'];
      if (linha.availability === 'UNAVAILABLE') return [item.id, null];
      const preco = parseCents(linha.preco);
      if (preco === null || preco < 1) return [item.id, 'Informe o preço unitário (ex.: 150,00)'];
      if (linha.prazo && !/^\d{1,3}$/.test(linha.prazo)) return [item.id, 'Prazo em dias, só números'];
      return [item.id, null];
    }),
  );
  const freteCents = frete.trim() ? parseCents(frete) : null;
  const freteInvalido = frete.trim() !== '' && freteCents === null;
  const respondidas = quote.items.filter((item) => linhas[item.id]!.availability).length;
  const tudoCerto = Object.values(problemas).every((p) => p === null) && !freteInvalido && nome.trim().length >= 2;

  const total = quote.items.reduce((soma, item) => {
    const linha = linhas[item.id]!;
    if (!linha.availability || linha.availability === 'UNAVAILABLE') return soma;
    return soma + Math.round((parseCents(linha.preco) ?? 0) * item.quantity);
  }, 0);
  const temAlguma = quote.items.some((item) => {
    const a = linhas[item.id]!.availability;
    return a === 'AVAILABLE' || a === 'TO_ORDER';
  });

  function revisar() {
    setTentou(true);
    setErro(null);
    if (tudoCerto) {
      setConfirmando(true);
      return;
    }
    const primeira = quote.items.find((item) => problemas[item.id]);
    document.getElementById(primeira ? `peca-${primeira.id}` : 'fornecedor-nome')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function enviar() {
    setEnviando(true);
    setErro(null);
    const corpo: SupplierResponseBody = {
      contentHash: quote.contentHash,
      responderName: nome.trim(),
      shippingCents: temAlguma ? freteCents : null,
      notes: obs.trim(),
      items: quote.items.map((item) => {
        const linha = linhas[item.id]!;
        const naoTem = linha.availability === 'UNAVAILABLE';
        return {
          requestItemId: item.id,
          availability: linha.availability!,
          unitPriceCents: naoTem ? null : parseCents(linha.preco),
          brand: naoTem ? '' : linha.marca.trim(),
          leadTimeDays: naoTem || !linha.prazo ? null : Number(linha.prazo),
          notes: linha.obs.trim(),
        };
      }),
    };
    try {
      const atualizada = await sendSupplierResponse(token, corpo);
      setQuote(atualizada);
      setEnviada(true);
      setConfirmando(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setErro(err as SupplierQuoteError);
      setConfirmando(false);
      const e = err as SupplierQuoteError;
      // a cotação fechou enquanto ele digitava: a tela passa a mostrar o estado real
      if (e.code === 'SUPPLIER_QUOTE_CLOSED') {
        loadSupplierQuote(token).then(setQuote).catch(() => undefined);
      }
    } finally {
      setEnviando(false);
    }
  }

  const telefone = formatPhone(quote.shopPhone);
  const carro = quote.vehicle
    ? [quote.vehicle.make, quote.vehicle.model, quote.vehicle.version, quote.vehicle.year].filter(Boolean).join(' ')
    : null;

  return (
    <div className={`min-h-dvh bg-neutral-50 text-neutral-900 ${quote.answerable ? 'pb-40' : 'pb-12'}`}>
      <header className="bg-white px-5 py-4 shadow-sm">
        <p className="text-lg font-bold">{quote.shopName}</p>
        {telefone && <p className="text-sm text-neutral-600">{telefone}</p>}
      </header>

      <main className="mx-auto max-w-xl px-5">
        <section className="pt-6">
          <h1 className="text-2xl font-bold">Cotação de peças nº {quote.number}</h1>
          <p className="mt-1 text-neutral-600">
            Olá, {quote.supplierName}. A oficina pede o seu preço para as peças abaixo.
            {quote.answerable && ` Responda até ${formatDateTime(quote.expiresAt)}.`}
          </p>
          {carro && (
            <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
              <p className="text-sm text-neutral-600">Para o veículo</p>
              <p className="font-semibold">{carro}</p>
              {(quote.vehicle?.engine || quote.vehicle?.vin) && (
                <p className="mt-0.5 text-sm text-neutral-700">
                  {[quote.vehicle.engine && `Motor ${quote.vehicle.engine}`, quote.vehicle.vin && `Chassi ${quote.vehicle.vin}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
          )}
        </section>

        {quote.message && (
          <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm whitespace-pre-line text-amber-900">{quote.message}</p>
        )}

        {enviada && (
          <div role="status" className="mt-4 rounded-xl bg-emerald-50 p-4">
            <p className="font-semibold text-emerald-900">Resposta enviada. Obrigado!</p>
            <p className="mt-1 text-sm text-emerald-900">
              A oficina já foi avisada.{quote.answerable && ' Se precisar corrigir algo, é só mudar e enviar de novo até o prazo.'}
            </p>
          </div>
        )}
        {!enviada && quote.lastResponse && quote.answerable && (
          <div className="mt-4 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">
            Você respondeu em {formatDateTime(quote.lastResponse.createdAt)}. Pode corrigir até o prazo: vale a última resposta.
          </div>
        )}
        {!quote.answerable && <Encerrada quote={quote} />}
        {erro && (
          <div role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-900">
            <p className="font-semibold">{erro.title}</p>
            <p className="mt-1">{erro.detail}</p>
            {erro.code === 'SUPPLIER_QUOTE_OUTDATED' && (
              <button type="button" onClick={() => window.location.reload()} className="mt-2 font-semibold underline">
                Recarregar a página
              </button>
            )}
          </div>
        )}

        <ul className="mt-6 space-y-3">
          {quote.items.map((item, indice) => {
            const linha = linhas[item.id]!;
            const problema = tentou ? problemas[item.id] : null;
            const naoTem = linha.availability === 'UNAVAILABLE';
            const bloqueado = !quote.answerable;
            return (
              <li key={item.id} id={`peca-${item.id}`} className={`rounded-xl bg-white p-4 shadow-sm ${problema ? 'ring-2 ring-red-400' : ''}`}>
                <p className="text-sm text-neutral-500">
                  Peça {indice + 1} de {quote.items.length}
                </p>
                <p className="text-lg font-semibold">{item.description}</p>
                <p className="text-sm text-neutral-700">
                  {[
                    `Quantidade: ${item.quantity.toLocaleString('pt-BR')} ${item.unit.toLowerCase()}`,
                    item.partCode && `Código ${item.partCode}`,
                    item.brand && `Marca ${item.brand}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>

                <fieldset className="mt-3" disabled={bloqueado}>
                  <legend className="sr-only">Você tem {item.description}?</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {OPCOES.map((opcao) => {
                      const marcada = linha.availability === opcao.valor;
                      return (
                        <label
                          key={opcao.valor}
                          className={`flex min-h-12 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-sm font-semibold ${
                            marcada
                              ? opcao.valor === 'UNAVAILABLE'
                                ? 'border-neutral-700 bg-neutral-700 text-white'
                                : 'border-emerald-700 bg-emerald-700 text-white'
                              : 'border-neutral-300 bg-white text-neutral-800'
                          }`}
                        >
                          <input
                            type="radio"
                            className="sr-only"
                            name={`disp-${item.id}`}
                            checked={marcada}
                            onChange={() => mudar(item.id, { availability: opcao.valor })}
                          />
                          {opcao.rotulo}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {linha.availability && !naoTem && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="col-span-2 block text-sm font-medium sm:col-span-1">
                      Preço unitário (R$)
                      <input
                        className={campo}
                        inputMode="decimal"
                        autoComplete="off"
                        disabled={bloqueado}
                        value={linha.preco}
                        onChange={(event) => mudar(item.id, { preco: event.target.value })}
                        placeholder="0,00"
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      Prazo (dias)
                      <input
                        className={campo}
                        inputMode="numeric"
                        autoComplete="off"
                        disabled={bloqueado}
                        value={linha.prazo}
                        onChange={(event) => mudar(item.id, { prazo: event.target.value.replace(/\D/g, '') })}
                        placeholder={linha.availability === 'AVAILABLE' ? '0 = hoje' : 'ex.: 3'}
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      Marca
                      <input
                        className={campo}
                        maxLength={60}
                        disabled={bloqueado}
                        value={linha.marca}
                        onChange={(event) => mudar(item.id, { marca: event.target.value })}
                        placeholder="Opcional"
                      />
                    </label>
                  </div>
                )}
                {linha.availability && (
                  <label className="mt-3 block text-sm font-medium">
                    Observação
                    <input
                      className={campo}
                      maxLength={300}
                      disabled={bloqueado}
                      value={linha.obs}
                      onChange={(event) => mudar(item.id, { obs: event.target.value })}
                      placeholder={naoTem ? 'Opcional, ex.: só a paralela' : 'Opcional, ex.: original na caixa'}
                    />
                  </label>
                )}
                {problema && <p className="mt-2 text-sm font-medium text-red-700">{problema}</p>}
              </li>
            );
          })}
        </ul>

        <section className="mt-6 space-y-4 rounded-xl bg-white p-4 shadow-sm">
          {temAlguma && (
            <label className="block text-sm font-medium">
              Frete (R$)
              <input
                className={campo}
                inputMode="decimal"
                autoComplete="off"
                disabled={!quote.answerable}
                value={frete}
                onChange={(event) => setFrete(event.target.value)}
                placeholder="Deixe vazio se não cobra"
              />
              {tentou && freteInvalido && <span className="mt-1 block text-red-700">Frete inválido (ex.: 20,00)</span>}
            </label>
          )}
          <label className="block text-sm font-medium">
            Observações para a oficina
            <textarea
              className={campo}
              rows={2}
              maxLength={1000}
              disabled={!quote.answerable}
              value={obs}
              onChange={(event) => setObs(event.target.value)}
              placeholder="Opcional, ex.: condição de pagamento"
            />
          </label>
          <label className="block text-sm font-medium" id="fornecedor-nome">
            Seu nome
            <input
              className={campo}
              maxLength={120}
              autoComplete="name"
              disabled={!quote.answerable}
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              placeholder="Quem está respondendo"
            />
            {tentou && nome.trim().length < 2 && <span className="mt-1 block text-red-700">Informe o seu nome</span>}
          </label>
        </section>

        <p className="mt-6 text-center text-xs text-neutral-500">
          Sua resposta vai só para a {quote.shopName}. Outros fornecedores não veem os seus preços.
        </p>
      </main>

      {quote.answerable && (
        <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white p-4 shadow-lg">
          <div className="mx-auto max-w-xl">
            <div className="mb-2 flex items-baseline justify-between text-sm text-neutral-600">
              <span>
                {respondidas} de {quote.items.length} {quote.items.length === 1 ? 'peça respondida' : 'peças respondidas'}
              </span>
              {total > 0 && <span className="text-base font-bold text-neutral-900">{formatBRL(total + (freteCents ?? 0))}</span>}
            </div>
            <button
              type="button"
              onClick={revisar}
              className="w-full rounded-xl bg-emerald-600 px-5 py-4 text-lg font-semibold text-white"
            >
              {quote.lastResponse ? 'Enviar correção' : 'Enviar resposta'}
            </button>
          </div>
        </div>
      )}

      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={() => !enviando && setConfirmando(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmar-titulo"
            className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="confirmar-titulo" className="text-lg font-bold">
              Confira antes de enviar
            </h2>
            <ul className="mt-3 divide-y divide-neutral-200 text-sm">
              {quote.items.map((item) => {
                const linha = linhas[item.id]!;
                const preco = parseCents(linha.preco);
                return (
                  <li key={item.id} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-medium">{item.description}</span>
                      <span className="block text-neutral-600">
                        {OPCOES.find((o) => o.valor === linha.availability)?.rotulo}
                        {linha.availability !== 'UNAVAILABLE' && linha.prazo && ` · ${linha.prazo === '0' ? 'hoje' : `${linha.prazo} dia(s)`}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {linha.availability === 'UNAVAILABLE' || preco === null ? (
                        '—'
                      ) : (
                        <>
                          <span className="block font-semibold">{formatBRL(preco)}</span>
                          {item.quantity !== 1 && (
                            <span className="block text-neutral-600">
                              {item.quantity.toLocaleString('pt-BR')} {item.unit.toLowerCase()} = {formatBRL(Math.round(preco * item.quantity))}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 space-y-1 border-t border-neutral-200 pt-2 text-sm">
              {freteCents !== null && temAlguma && (
                <p className="flex justify-between">
                  <span>Frete</span>
                  <span>{formatBRL(freteCents)}</span>
                </p>
              )}
              <p className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span>{formatBRL(total + (temAlguma ? (freteCents ?? 0) : 0))}</span>
              </p>
            </div>
            <button
              type="button"
              disabled={enviando}
              onClick={() => void enviar()}
              className="mt-5 w-full rounded-xl bg-emerald-600 px-5 py-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              {enviando ? 'Enviando…' : 'Confirmar e enviar'}
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => setConfirmando(false)}
              className="mt-2 w-full rounded-xl px-5 py-3 font-medium text-neutral-600"
            >
              Voltar e corrigir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Encerrada({ quote }: { quote: PublicSupplierQuote }) {
  const texto = {
    CLOSED: ['A oficina já escolheu as ofertas', 'Obrigado pela resposta. Esta cotação não aceita mais mudanças.'],
    CANCELED: ['A oficina cancelou esta cotação', 'Não é preciso responder.'],
    EXPIRED: ['O prazo para responder acabou', 'Se ainda tiver as peças, fale direto com a oficina.'],
    OPEN: ['Cotação indisponível', 'Fale com a oficina.'],
  }[quote.state];
  return (
    <div className="mt-4 rounded-xl bg-neutral-200 p-4">
      <p className="font-semibold">{texto[0]}</p>
      <p className="mt-1 text-sm text-neutral-700">{texto[1]}</p>
      {quote.lastResponse && (
        <p className="mt-1 text-sm text-neutral-700">Sua última resposta foi em {formatDateTime(quote.lastResponse.createdAt)}.</p>
      )}
    </div>
  );
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-neutral-50 px-6 text-center text-neutral-700">{children}</div>;
}
