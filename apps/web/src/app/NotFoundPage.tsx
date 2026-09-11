import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <p className="tabular text-sm font-semibold text-accent dark:text-accent-bright">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Página não encontrada</h1>
        <p className="mt-2 text-muted">O endereço pode ter mudado ou não existe.</p>
        <Link
          to="/"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent-hover"
        >
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
