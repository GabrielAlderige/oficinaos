import { useEffect, useState } from 'react';
import type { PublicTracking } from '@oficinaos/shared';
import { formatBRL } from './format';

/**
 * "Acompanhe seu veículo" (E17). O cliente abre pelo link e vê em que pé está
 * o carro — sem ligar para a oficina e sem login.
 *
 * Mostra só o que é dele: o passo, a previsão, o que aprovou e quanto falta
 * pagar. Como as outras públicas, não carrega o painel junto.
 */
export function TrackingPage({ token }: { token: string }) {
  const [dados, setDados] = useState<PublicTracking | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const resposta = await fetch(`/api/v1/public/tracking/${encodeURIComponent(token)}`);
        if (!resposta.ok) throw new Error('Link inválido ou expirado.');
        setDados((await resposta.json()) as PublicTracking);
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Não foi possível abrir o acompanhamento.');
      }
    })();
  }, [token]);

  if (erro) {
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
        <div className="mt-4 h-40 animate-pulse rounded bg-surface-muted" />
      </main>
    );
  }

  const cancelada = dados.status === 'CANCELED';
  return (
    <main className="mx-auto max-w-md px-5 py-8">
      <p className="text-sm text-muted">{dados.shopName}</p>
      <h1 className="mt-1 text-xl font-semibold">{dados.headline}</h1>
      <p className="mt-1 text-sm text-muted">
        {dados.vehicleLabel} · OS nº {dados.number}
      </p>

      {dados.promisedAt && !cancelada && (
        <p className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          Previsão de entrega: <strong>{formatarData(dados.promisedAt)}</strong>
        </p>
      )}

      <ol className="mt-6 space-y-0">
        {dados.steps.map((passo, indice) => (
          <li key={passo.key} className="flex gap-3">
            <span className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={`mt-1 grid size-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                  passo.current
                    ? 'border-accent bg-accent text-accent-foreground'
                    : passo.done
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border text-muted'
                }`}
              >
                {passo.done ? '✓' : ''}
              </span>
              {indice < dados.steps.length - 1 && (
                <span aria-hidden="true" className={`w-px flex-1 ${passo.done ? 'bg-accent' : 'bg-border'}`} />
              )}
            </span>
            <span className="pb-6">
              <span className={`block text-sm ${passo.current ? 'font-semibold' : passo.done ? '' : 'text-muted'}`}>
                {passo.label}
              </span>
              {passo.at && <span className="block text-xs text-muted">{formatarData(passo.at)}</span>}
            </span>
          </li>
        ))}
      </ol>

      {dados.approvedTotalCents !== null && (
        <dl className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Serviço aprovado</dt>
            <dd className="font-medium">{formatBRL(dados.approvedTotalCents)}</dd>
          </div>
          {dados.balanceCents !== null && dados.balanceCents > 0 && (
            <div className="mt-1 flex justify-between">
              <dt className="text-muted">Falta pagar</dt>
              <dd className="font-medium">{formatBRL(dados.balanceCents)}</dd>
            </div>
          )}
        </dl>
      )}

      {dados.shopWhatsapp && (
        <a
          className="mt-6 flex items-center justify-center rounded-md border border-border px-4 py-2.5 text-sm font-medium"
          href={`https://wa.me/${dados.shopWhatsapp.replace(/\D/g, '')}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Falar com a {dados.shopName}
        </a>
      )}
      <p className="mt-4 text-center text-xs text-muted">Esta página atualiza sozinha sempre que você abrir.</p>
    </main>
  );
}

/** "18/09 às 14:32", no relógio de quem está lendo. */
function formatarData(iso: string): string {
  const data = new Date(iso);
  return `${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(data)} às ${new Intl.DateTimeFormat(
    'pt-BR',
    { hour: '2-digit', minute: '2-digit' },
  ).format(data)}`;
}
