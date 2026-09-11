import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { FullPageSpinner } from '../components/brand';
import { safeNext } from '../lib/format';
import { useSession } from '../lib/session';

/** Rotas do painel: sem sessão, vai para o login e volta para onde estava. */
export function RequireAuth() {
  const { state } = useSession();
  const location = useLocation();
  if (state.status === 'loading') return <FullPageSpinner />;
  if (state.status === 'anonymous') {
    const next = location.pathname + location.search;
    // quem clicou em Sair não ganha "voltar para": o próximo login começa do início
    const keepNext = state.reason !== 'signed-out' && next !== '/';
    return <Navigate to={keepNext ? `/entrar?next=${encodeURIComponent(next)}` : '/entrar'} replace />;
  }
  return <Outlet />;
}

/** Login e cadastro: quem já está logado segue direto para o painel. */
export function PublicOnly() {
  const { state } = useSession();
  const [params] = useSearchParams();
  if (state.status === 'loading') return <FullPageSpinner />;
  if (state.status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <Outlet />;
}
