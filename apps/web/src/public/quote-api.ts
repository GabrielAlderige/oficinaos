import type { PublicQuote } from '@oficinaos/shared';

/**
 * Cliente HTTP da página do orçamento: `fetch` puro, sem token de sessão e sem
 * as camadas do painel. A credencial é o token que já está na URL.
 */
const BASE = '/api/v1/public/quotes';

export interface QuoteError {
  code: string;
  title: string;
  detail: string;
  status: number;
}

export type ViewResult = { quote: PublicQuote } | { redirectToken: string };

async function parse<T>(response: Response): Promise<T> {
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const data: unknown = isJson ? await response.json() : null;
  if (!response.ok) {
    const problem = (data ?? {}) as Partial<QuoteError>;
    throw {
      code: problem.code ?? 'ERRO',
      title: problem.title ?? 'Não foi possível concluir',
      detail: problem.detail ?? 'Tente de novo em instantes.',
      status: response.status,
    } satisfies QuoteError;
  }
  return data as T;
}

export async function loadQuote(token: string): Promise<ViewResult> {
  const data = await parse<PublicQuote | { redirectToken: string }>(await fetch(`${BASE}/${token}`));
  return 'redirectToken' in data ? data : { quote: data };
}

const send = <T>(token: string, action: string, body: unknown) =>
  fetch(`${BASE}/${token}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((response) => parse<T>(response));

export const approveQuote = (
  token: string,
  input: { approvedItemIds: string[]; signerName: string; contentHash: string },
) => send<PublicQuote>(token, 'approve', { ...input, accepted: true });

export const rejectQuote = (token: string, input: { reason: string; contentHash: string }) =>
  send<PublicQuote>(token, 'reject', input);

export const askQuestion = (token: string, message: string) => send<null>(token, 'questions', { message });
