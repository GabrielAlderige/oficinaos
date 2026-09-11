import { useQuery } from '@tanstack/react-query';
import type { HealthResponse, ReadyResponse } from '@oficinaos/shared';
import { CheckCircle2, Database, Moon, Server, Sun, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api-client';
import { useTheme } from '../../lib/theme';

/**
 * Tela da etapa E1: prova que painel, API e banco estão ligados.
 * Na E2 a raiz do painel passa a ser o login e esta tela sai.
 */
export function FoundationPage() {
  const { theme, toggle } = useTheme();

  const health = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => api<HealthResponse>('/health'),
    refetchInterval: 10_000,
  });

  // /ready responde 503 com corpo útil quando o banco cai: lemos o corpo nos dois casos
  const ready = useQuery({
    queryKey: ['system', 'ready'],
    queryFn: async (): Promise<ReadyResponse> => {
      const res = await fetch('/api/v1/ready');
      if (!res.ok && res.status !== 503) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 10_000,
  });

  const apiOk = health.data?.status === 'ok';
  const dbOk = ready.data?.database === 'ok';

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <button
            type="button"
            onClick={toggle}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground"
            aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-xs font-semibold tracking-wide text-accent uppercase dark:text-accent-bright">
          MVP 1 · Etapa E1
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Fundação do sistema</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Painel, API e banco de dados conectados. A partir da próxima etapa, esta tela dá lugar ao
          login e ao painel da oficina.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <StatusCard
            icon={<Server className="size-5" />}
            title="API"
            loading={health.isPending}
            ok={apiOk}
            okText="Respondendo"
            failText="Sem resposta. A API está rodando?"
            detail={health.data ? `versão ${health.data.version}` : undefined}
          />
          <StatusCard
            icon={<Database className="size-5" />}
            title="Banco de dados"
            loading={ready.isPending}
            ok={dbOk}
            okText="PostgreSQL conectado"
            failText="Indisponível"
            detail={ready.data?.latencyMs !== undefined ? `${ready.data.latencyMs} ms` : undefined}
          />
        </div>

        <section className="mt-10 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-semibold">O que esta etapa garante</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>Cada oficina só enxerga os próprios dados, com o isolamento feito pelo próprio banco (RLS).</li>
            <li>A API conecta com uma role que não consegue ignorar esse isolamento.</li>
            <li>Todo erro volta num formato único (problem+json), com um código estável.</li>
            <li>Cabeçalhos de segurança, CORS restrito e limite de requisições desde o primeiro dia.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-foreground" />
        <circle cx="16" cy="16" r="7" fill="none" stroke="#f26b1d" strokeWidth="3.5" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">
        Oficina<span className="text-accent dark:text-accent-bright">OS</span>
      </span>
    </div>
  );
}

interface StatusCardProps {
  icon: ReactNode;
  title: string;
  loading: boolean;
  ok: boolean;
  okText: string;
  failText: string;
  detail?: string;
}

function StatusCard({ icon, title, loading, ok, okText, failText, detail }: StatusCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-sm font-medium">{title}</span>
      </div>
      {loading ? (
        <div className="mt-4 h-6 w-40 animate-pulse rounded bg-surface-muted" aria-label="Carregando" />
      ) : (
        <div className="mt-4 flex items-center gap-2">
          {ok ? (
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
          ) : (
            <XCircle className="size-5 text-danger" aria-hidden="true" />
          )}
          <span className="font-medium">{ok ? okText : failText}</span>
          {ok && detail && <span className="tabular ml-auto text-sm text-muted">{detail}</span>}
        </div>
      )}
    </div>
  );
}
