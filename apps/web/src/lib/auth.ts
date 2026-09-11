import type { AuthResponse } from '@oficinaos/shared';

/**
 * Access token SÓ em memória (ARCHITECTURE §6): XSS não o encontra em
 * localStorage. O refresh token vive num cookie httpOnly que o JS nem vê;
 * recarregar a página recupera a sessão chamando /auth/refresh.
 */
let accessToken: string | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (token: string) => {
    accessToken = token;
  },
  clear: () => {
    accessToken = null;
  },
};

const logoutListeners = new Set<() => void>();

/** A sessão caiu (refresh recusado): quem ouve volta para o login. */
export function onForcedLogout(listener: () => void): () => void {
  logoutListeners.add(listener);
  return () => logoutListeners.delete(listener);
}

export function notifyForcedLogout() {
  tokenStore.clear();
  logoutListeners.forEach((listener) => listener());
}

let inflight: Promise<AuthResponse | null> | null = null;

/**
 * Renovação single-flight: dentro da aba, chamadas simultâneas esperam a mesma
 * promessa; entre abas, a Web Locks API faz fila, então duas abas nunca gastam
 * o mesmo refresh token (o que a API trataria como roubo).
 */
export function refreshSession(): Promise<AuthResponse | null> {
  inflight ??= (async () => {
    const run = async (): Promise<AuthResponse | null> => {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      // 204 = não havia sessão para renovar (visitante); 401 = sessão encerrada
      if (response.status === 204 || !response.ok) return null;
      const data = (await response.json()) as AuthResponse;
      tokenStore.set(data.accessToken);
      return data;
    };
    try {
      return 'locks' in navigator ? await navigator.locks.request('oficinaos:refresh', run) : await run();
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
