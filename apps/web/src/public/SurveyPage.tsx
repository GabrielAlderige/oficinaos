import { useEffect, useState } from 'react';
import type { PublicSurvey } from '@oficinaos/shared';

const NOTAS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * A pesquisa de satisfação (E49): uma pergunta, de 0 a 10, e um comentário.
 * Abre no celular, sem login, pelo link do WhatsApp.
 *
 * Depois de responder, o convite para avaliar no Google aparece para QUALQUER
 * nota. Mostrar o Google só para quem deu nota alta é proibido pelo Google
 * (review gating) — e é desonesto com quem procura oficina.
 */
export function SurveyPage({ token }: { token: string }) {
  const [dados, setDados] = useState<PublicSurvey | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [falhaAoEnviar, setFalhaAoEnviar] = useState<string | null>(null);
  const url = `/api/v1/public/surveys/${encodeURIComponent(token)}`;

  useEffect(() => {
    void (async () => {
      try {
        const resposta = await fetch(url);
        if (!resposta.ok) throw new Error('Este link não abre mais. Se a oficina mandou um novo, use o mais recente.');
        setDados((await resposta.json()) as PublicSurvey);
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Não foi possível abrir a pesquisa.');
      }
    })();
  }, [url]);

  async function enviar() {
    if (nota === null) return;
    setEnviando(true);
    setFalhaAoEnviar(null);
    try {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ score: nota, comment: comentario }),
      });
      if (resposta.status === 409) throw new Error('Esta pesquisa já foi respondida. Obrigado!');
      if (!resposta.ok) throw new Error('Não deu para enviar agora. Tente de novo em instantes.');
      setDados((await resposta.json()) as PublicSurvey);
    } catch (err) {
      setFalhaAoEnviar(err instanceof Error ? err.message : 'Não deu para enviar agora.');
    } finally {
      setEnviando(false);
    }
  }

  if (erro) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <h1 className="text-xl font-semibold">Pesquisa indisponível</h1>
        <p className="mt-2 text-sm text-muted">{erro}</p>
      </main>
    );
  }

  if (!dados) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <div className="h-8 w-2/3 animate-pulse rounded bg-surface-muted" />
        <div className="mt-4 h-40 animate-pulse rounded bg-surface-muted" />
      </main>
    );
  }

  if (dados.answered) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <p className="text-sm text-muted">{dados.shopName}</p>
        <h1 className="mt-1 text-2xl font-semibold">Obrigado, {dados.customerFirstName}!</h1>
        <p className="mt-2 text-sm text-muted">
          Sua resposta foi direto para a oficina. É assim que ela melhora o atendimento.
        </p>
        {dados.googleReviewUrl && (
          <div className="mt-6 rounded-xl border border-border bg-surface p-4">
            <p className="text-sm">Quer contar a sua experiência para outras pessoas? Você pode avaliar a oficina no Google.</p>
            <a
              href={dados.googleReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg border border-border bg-surface font-medium hover:bg-surface-muted"
            >
              Avaliar no Google
            </a>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-5 py-8">
      <p className="text-sm text-muted">{dados.shopName}</p>
      <h1 className="mt-1 text-xl font-semibold">Olá, {dados.customerFirstName}! Como foi o serviço?</h1>
      <p className="mt-1 text-sm text-muted">
        {dados.vehicle} · OS nº {dados.workOrderNumber}
      </p>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">De 0 a 10, quanto você recomendaria a oficina a um amigo?</legend>
        <div role="radiogroup" aria-label="Nota de 0 a 10" className="mt-3 grid grid-cols-6 gap-2 sm:grid-cols-11">
          {NOTAS.map((valor) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={nota === valor}
              onClick={() => setNota(valor)}
              className={`h-11 rounded-lg border text-base font-semibold tabular-nums transition-colors ${
                nota === valor ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-surface hover:bg-surface-muted'
              }`}
            >
              {valor}
            </button>
          ))}
        </div>
        <p className="mt-1.5 flex justify-between text-xs text-muted">
          <span>0 = não recomendaria</span>
          <span>10 = recomendaria com certeza</span>
        </p>
      </fieldset>

      <label className="mt-6 block text-sm font-medium" htmlFor="comentario">
        Quer contar mais? <span className="font-normal text-muted">(opcional)</span>
      </label>
      <textarea
        id="comentario"
        rows={4}
        maxLength={1000}
        value={comentario}
        onChange={(event) => setComentario(event.target.value)}
        placeholder="O que foi bom, o que podia ser melhor"
        className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base"
      />

      {falhaAoEnviar && <p className="mt-3 text-sm text-danger">{falhaAoEnviar}</p>}

      <button
        type="button"
        disabled={nota === null || enviando}
        onClick={() => void enviar()}
        className="mt-5 h-12 w-full rounded-lg bg-accent font-semibold text-accent-foreground disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Enviar resposta'}
      </button>
      <p className="mt-3 text-center text-xs text-muted">Sua resposta vai só para a oficina.</p>
    </main>
  );
}
