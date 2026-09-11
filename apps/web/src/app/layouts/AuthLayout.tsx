import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { Brand } from '../../components/brand';
import { ThemeToggle } from './shell-parts';

/** Telas de acesso: painel da marca à esquerda (desktop), formulário à direita. */
export function AuthLayout() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* a classe "dark" troca os tokens só aqui dentro: o painel é sempre escuro */}
      <aside className="dark relative hidden flex-col justify-between overflow-hidden bg-background p-10 text-foreground lg:flex">
        <Brand />
        <div className="relative z-10 max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">
            Sua oficina organizada, do orçamento à entrega.
          </h2>
          <p className="text-muted">
            Clientes, veículos, ordens de serviço e orçamentos num lugar só, no lugar de papel, planilha e
            mensagem perdida.
          </p>
        </div>
        <p className="text-xs text-muted">OficinaOS</p>
        <svg viewBox="0 0 400 400" className="pointer-events-none absolute -right-24 -bottom-24 size-[28rem] opacity-60" aria-hidden="true">
          {[60, 110, 160, 210].map((r) => (
            <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="#f26b1d" strokeOpacity={0.9 - r / 300} strokeWidth="2" />
          ))}
        </svg>
      </aside>

      <main className="flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <span className="lg:invisible">
            <Brand />
          </span>
          <ThemeToggle />
        </div>
        <div className="m-auto w-full max-w-sm py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function AuthHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-7 space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="text-sm text-muted">{description}</p>}
    </div>
  );
}
