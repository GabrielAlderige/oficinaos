import type { Problem } from '@oficinaos/shared';
import { notifyForcedLogout, refreshSession, tokenStore } from './auth';

/** Erro de API com o problem+json já lido. A UI decide a mensagem pelo `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `Erro HTTP ${status}`);
    this.name = 'ApiError';
  }

  get code(): string | undefined {
    return this.problem?.code;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
}

async function send(path: string, { json, headers, ...init }: RequestOptions): Promise<Response> {
  const finalHeaders = new Headers(headers);
  finalHeaders.set('accept', 'application/json');
  if (json !== undefined) finalHeaders.set('content-type', 'application/json');
  const token = tokenStore.get();
  if (token) finalHeaders.set('authorization', `Bearer ${token}`);

  try {
    return await fetch(`/api/v1${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: finalHeaders,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch {
    throw new ApiError(0, null); // sem rede ou API fora do ar
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const data: unknown = isJson ? await response.json() : null;
  if (!response.ok) {
    const problem = data && typeof data === 'object' && 'code' in data ? (data as Problem) : null;
    throw new ApiError(response.status, problem);
  }
  return data as T;
}

/**
 * Cliente HTTP do painel. Um 401 com sessão ativa dispara UMA renovação e
 * repete a chamada; se a renovação falhar, a sessão acabou de verdade.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const hadToken = Boolean(tokenStore.get());
  const response = await send(path, options);
  if (response.status === 401 && hadToken) {
    if (await refreshSession()) return parse<T>(await send(path, options));
    notifyForcedLogout();
  }
  return parse<T>(response);
}
