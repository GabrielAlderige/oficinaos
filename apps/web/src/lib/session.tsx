import { useQueryClient } from '@tanstack/react-query';
import { can, type AuthResponse, type Me, type Permission } from '@oficinaos/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api-client';
import { onForcedLogout, refreshSession, tokenStore } from './auth';

type SessionState =
  | { status: 'loading' }
  /**
   * reason: 'session-ended' = caiu por fora (desativado, senha trocada, encerrada em outro aparelho);
   * 'signed-out' = a pessoa clicou em Sair (o próximo login começa do início).
   */
  | { status: 'anonymous'; reason?: 'session-ended' | 'signed-out' }
  | { status: 'authenticated'; me: Me };

interface SessionContextValue {
  state: SessionState;
  signIn(response: AuthResponse): void;
  signOut(): Promise<void>;
  refreshMe(): Promise<void>;
  switchOrganization(organizationId: string): Promise<Me>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  // ao abrir o painel: o cookie httpOnly traz a sessão de volta, se houver
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((response) => {
      if (!cancelled) setState(response ? { status: 'authenticated', me: response.me } : { status: 'anonymous' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onForcedLogout(() => {
        queryClient.clear();
        setState({ status: 'anonymous', reason: 'session-ended' });
      }),
    [queryClient],
  );

  const authenticated = state.status === 'authenticated';

  // Papel e acesso em dia: ao voltar para a aba (e a cada 5 min) o painel relê
  // /auth/me. Quem foi desativado cai para o login; quem mudou de papel vê os
  // botões certos. (A API já barra na hora; isto é para a TELA não mentir.)
  useEffect(() => {
    if (!authenticated) return;
    let lastCheck = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 15_000) return;
      lastCheck = Date.now();
      void api<Me>('/auth/me')
        .then((me) => setState({ status: 'authenticated', me }))
        .catch(() => undefined); // 401 sem renovação possível já dispara o logout forçado
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(() => {
      lastCheck = 0;
      check();
    }, 5 * 60_000);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [authenticated]);

  const signIn = useCallback((response: AuthResponse) => {
    tokenStore.set(response.accessToken);
    setState({ status: 'authenticated', me: response.me });
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    tokenStore.clear();
    queryClient.clear();
    setState({ status: 'anonymous', reason: 'signed-out' });
  }, [queryClient]);

  const refreshMe = useCallback(async () => {
    const me = await api<Me>('/auth/me');
    setState({ status: 'authenticated', me });
  }, []);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      const response = await api<AuthResponse>('/auth/switch-organization', {
        method: 'POST',
        json: { organizationId },
      });
      queryClient.clear(); // nada da oficina anterior fica em cache
      signIn(response);
      return response.me;
    },
    [queryClient, signIn],
  );

  const value = useMemo(
    () => ({ state, signIn, signOut, refreshMe, switchOrganization }),
    [state, signIn, signOut, refreshMe, switchOrganization],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession fora do SessionProvider');
  return context;
}

/** Só dentro de rotas protegidas (RequireAuth garante a sessão). */
export function useMe(): Me {
  const { state } = useSession();
  if (state.status !== 'authenticated') throw new Error('useMe exige sessão autenticada');
  return state.me;
}

/** A matriz é a mesma da API: o painel esconde, a API garante. */
export function useCan(permission: Permission): boolean {
  const { state } = useSession();
  return state.status === 'authenticated' && can(state.me.role, permission);
}
