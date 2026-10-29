import { useEffect, useState } from 'react';
import type { PublicPortal } from '@oficinaos/shared';
import { formatBRL, formatDate } from './format';

const DIA_HORA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Link do WhatsApp da oficina com a mensagem pronta. */
function linkDaOficina(whatsapp: string, texto: string): string {
  const digitos = whatsapp.replace(/\D/g, '');
  const numero = digitos.startsWith('55') ? digitos : `55${digitos}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/**
 * O app do cliente (E50): os carros dele na oficina, o que está em andamento,
 * o orçamento esperando resposta e o histórico. Abre no navegador do celular,
 * e o navegador oferece "Adicionar à tela inicial" (o manifesto vem por token).
 */
export function PortalPage({ token }: { token: string }) {
  const [dados, setDados] = useState<PublicPortal | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // o "pôr na tela inicial" abre neste link, então o manifesto é deste cliente
    const manifesto = document.createElement('link');
    manifesto.rel = 'manifest';
    manifesto.href = `/api/v1/public/portal/${encodeURIComponent(token)}/manifest.webmanifest`;
    document.head.appendChild(manifesto);
    void (async () => {
      try {
        const resposta = await fetch(`/api/v1/public/portal/${encodeURIComponent(token)}`);
        if (!resposta.ok) throw new Error('Este link não abre mais. Peça um novo à oficina.');
        const corpo = (await resposta.json()) as PublicPortal;
        document.title = corpo.shopName;
        setDados(corpo);
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Não foi possível abrir.');
      }
    })();
    return () => manifesto.remove();
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

  const pedirHorario = dados.shopWhatsapp
    ? linkDaOficina(dados.shopWhatsapp, `Olá! Aqui é ${dados.customerFirstName}. Quero marcar um horário para o meu carro.`)
    : null;

  return (
    <main className="mx-auto max-w-md px-5 pt-6 pb-10">
      <header>
        <p className="text-sm text-muted">Olá, {dados.customerFirstName}</p>
        <h1 className="mt-0.5 text-2xl font-semibold">{dados.shopName}</h1>
        {dados.shopAddress && <p className="mt-1 text-xs text-muted">{dados.shopAddress}</p>}
        {pedirHorario && (
          <a
            href={pedirHorario}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex h-12 items-center justify-center rounded-xl bg-accent font-semibold text-accent-foreground"
          >
            Pedir horário pelo WhatsApp
          </a>
        )}
      </header>

      {dados.quotes.length > 0 && (
        <section className="mt-7">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Esperando a sua resposta</h2>
          <ul className="mt-2 space-y-2">
            {dados.quotes.map((orcamento) => (
              <li key={orcamento.number}>
                <a href={orcamento.url} className="block rounded-xl border-2 border-accent bg-surface p-4">
                  <span className="block text-sm text-muted">Orçamento nº {orcamento.number} · {orcamento.vehicleLabel}</span>
                  <span className="mt-1 block text-xl font-semibold">{formatBRL(orcamento.totalCents)}</span>
                  <span className="mt-1 block text-sm font-medium text-accent">Ver e responder →</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dados.current.length > 0 && (
        <section className="mt-7">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Na oficina agora</h2>
          <ul className="mt-2 space-y-2">
            {dados.current.map((os) => (
              <li key={os.number} className="rounded-xl border border-border bg-surface p-4">
                <p className="text-sm text-muted">
                  {os.vehicleLabel} · OS nº {os.number}
                </p>
                <p className="mt-1 font-medium">{os.headline}</p>
                {os.promisedAt && (
                  <p className="mt-1 text-sm">
                    Previsão: <strong>{DIA_HORA.format(new Date(os.promisedAt))}</strong>
                  </p>
                )}
                {os.trackingUrl && (
                  <a href={os.trackingUrl} className="mt-2 inline-block text-sm font-medium text-accent">
                    Acompanhar passo a passo →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Seus carros</h2>
        {dados.vehicles.length ? (
          <ul className="mt-2 space-y-2">
            {dados.vehicles.map((carro) => (
              <li key={carro.id} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
                <span className="font-medium">{carro.label}</span>
                {carro.plate && (
                  <span className="rounded border border-foreground/30 px-2 py-0.5 font-mono text-sm tracking-wider">{carro.plate}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Nenhum carro cadastrado ainda.</p>
        )}
      </section>

      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">O que já fizemos</h2>
        {dados.history.length ? (
          <ol className="mt-2 space-y-2">
            {dados.history.map((os) => (
              <li key={os.number} className="rounded-xl border border-border bg-surface p-4">
                <p className="flex justify-between gap-3 text-sm">
                  <span className="text-muted">
                    {formatDate(os.date)} · {os.vehicleLabel}
                  </span>
                  <span className="font-medium tabular-nums">{formatBRL(os.totalCents)}</span>
                </p>
                {os.services.length > 0 && <p className="mt-1 text-sm">{os.services.join(', ')}</p>}
                <p className="mt-1 text-xs text-muted">OS nº {os.number}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted">O histórico aparece aqui depois do primeiro serviço entregue.</p>
        )}
      </section>

      <p className="mt-10 text-center text-xs text-muted">
        Dica: no menu do navegador, toque em “Adicionar à tela inicial” para abrir como um aplicativo.
      </p>
    </main>
  );
}
