import { useEffect, useState } from 'react';
import type { PublicReview } from '@oficinaos/shared';

/**
 * A página de avaliação do cliente (E16). Abre pelo link do WhatsApp, no
 * celular, entre duas coisas — então é UMA pergunta: quantas estrelas. O
 * comentário é opcional e o envio é um toque.
 *
 * Como as outras páginas públicas, ela não carrega o painel: sem router, sem
 * TanStack Query e sem o índice do shared (ARCHITECTURE §8.2).
 */
const ESTRELAS = [1, 2, 3, 4, 5];
const LEGENDAS: Record<number, string> = {
  1: 'Péssimo',
  2: 'Ruim',
  3: 'Razoável',
  4: 'Bom',
  5: 'Excelente',
};

export function ReviewPage({ token }: { token: string }) {
  const [dados, setDados] = useState<PublicReview | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const resposta = await fetch(`/api/v1/public/reviews/${encodeURIComponent(token)}`);
        if (!resposta.ok) throw new Error('Link inválido ou expirado.');
        setDados((await resposta.json()) as PublicReview);
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Não foi possível abrir a avaliação.');
      }
    })();
  }, [token]);

  async function enviar() {
    if (nota === 0) return;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/v1/public/reviews/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating: nota, comment: comentario }),
      });
      if (!resposta.ok) throw new Error('Não foi possível enviar agora. Tente de novo em instantes.');
      setDados((await resposta.json()) as PublicReview);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  }

  if (erro && !dados) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <h1 className="text-xl font-semibold">Link indisponível</h1>
        <p className="mt-2 text-sm text-muted">{erro}</p>
      </main>
    );
  }

  if (!dados) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <div className="h-8 w-2/3 animate-pulse rounded bg-surface-muted" />
        <div className="mt-4 h-24 animate-pulse rounded bg-surface-muted" />
      </main>
    );
  }

  if (dados.submitted) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10 text-center">
        <p className="text-4xl" aria-hidden="true">
          {'★'.repeat(dados.rating ?? 0)}
        </p>
        <h1 className="mt-3 text-xl font-semibold">Obrigado pela avaliação!</h1>
        <p className="mt-2 text-sm text-muted">
          A {dados.shopName} recebeu sua resposta. Ela ajuda a oficina a melhorar de verdade.
        </p>
        {dados.googleReviewUrl && (
          <a
            className="mt-6 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
            href={dados.googleReviewUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Avaliar também no Google
          </a>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-5 py-8">
      <h1 className="text-xl font-semibold">Como foi o atendimento?</h1>
      <p className="mt-1 text-sm text-muted">
        {dados.shopName} · OS nº {dados.workOrderNumber}
        {dados.vehicleLabel ? ` · ${dados.vehicleLabel}` : ''}
      </p>

      {erro && (
        <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
          {erro}
        </p>
      )}

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Sua nota</legend>
        <div className="mt-2 flex justify-between gap-1">
          {ESTRELAS.map((estrela) => (
            <button
              key={estrela}
              type="button"
              onClick={() => setNota(estrela)}
              aria-label={`${estrela} ${estrela === 1 ? 'estrela' : 'estrelas'} — ${LEGENDAS[estrela]}`}
              aria-pressed={nota === estrela}
              className={`flex-1 rounded-lg border py-4 text-3xl transition-colors ${
                estrela <= nota ? 'border-accent-bright bg-accent-soft' : 'border-border'
              }`}
            >
              <span aria-hidden="true">{estrela <= nota ? '★' : '☆'}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 h-5 text-center text-sm text-muted">{nota ? LEGENDAS[nota] : ''}</p>
      </fieldset>

      <label className="mt-4 block text-sm font-medium" htmlFor="comentario">
        Quer contar alguma coisa? (opcional)
      </label>
      <textarea
        id="comentario"
        rows={4}
        value={comentario}
        onChange={(event) => setComentario(event.target.value)}
        placeholder="O que foi bom, o que pode melhorar…"
        className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />

      <button
        type="button"
        onClick={() => void enviar()}
        disabled={nota === 0 || enviando}
        className="mt-5 w-full rounded-md bg-accent px-4 py-3 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Enviar avaliação'}
      </button>
      <p className="mt-3 text-center text-xs text-muted">Leva 30 segundos e a oficina lê todas.</p>
    </main>
  );
}
