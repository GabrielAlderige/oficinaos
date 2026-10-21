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

/**
 * Login e cadastro: quem já está logado segue direto para o painel.
 *
 * O mecânico começa em **Minhas OS** (E24). Ele trabalha no celular, e a
 * primeira tela dele é a lista dos carros que estão com ele — o painel de
 * números é do balcão. Quem chegou por um link (`?next=`) vai para onde
 * queria ir, sempre.
 */
export function PublicOnly() {
  const { state } = useSession();
  const [params] = useSearchParams();
  const location = useLocation();
  if (state.status === 'loading') return <FullPageSpinner />;
  if (state.status === 'authenticated') {
    const pedido = params.get('next');
    /**
     * Quem acabou de criar a conta vai para as boas-vindas (D92). O destino é
     * decidido AQUI, e não por um `navigate` no cadastro: a rota das
     * boas-vindas é lazy, e enquanto ela carregava este redirecionamento já
     * mandava para o Início, atropelando o `navigate`.
     */
    const destino = pedido
      ? safeNext(pedido)
      : location.pathname === '/criar-conta'
        ? '/boas-vindas'
        : state.me.role === 'MECHANIC'
          ? '/minhas-os'
          : '/';
    return <Navigate to={destino} replace />;
  }
  return <Outlet />;
}
