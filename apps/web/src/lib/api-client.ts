import type { Problem } from '@oficinaos/shared';

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

/**
 * Cliente HTTP do painel. Na etapa E2 ganha o token de acesso e a renovação
 * automática (single-flight entre abas).
 */
export async function api<T>(path: string, { json, headers, ...init }: RequestOptions = {}): Promise<T> {
  const finalHeaders = new Headers(headers);
  finalHeaders.set('accept', 'application/json');
  if (json !== undefined) finalHeaders.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      headers: finalHeaders,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch {
    throw new ApiError(0, null); // sem rede ou API fora do ar
  }

  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const data: unknown = isJson ? await response.json() : null;
  if (!response.ok) {
    const problem = isJson && data && typeof data === 'object' && 'code' in data ? (data as Problem) : null;
    throw new ApiError(response.status, problem);
  }
  return data as T;
}
