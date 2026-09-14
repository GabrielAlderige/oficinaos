import type { OfferAvailability, PublicSupplierQuote } from '@oficinaos/shared';

/**
 * Cliente HTTP da página do fornecedor: `fetch` puro. A credencial é o token
 * da URL; nada de cookie, nada de sessão.
 */
const BASE = '/api/v1/public/supplier-quotes';

export interface SupplierQuoteError {
  code: string;
  title: string;
  detail: string;
  status: number;
}

export interface SupplierResponseBody {
  contentHash: string;
  responderName: string;
  shippingCents: number | null;
  notes: string;
  items: {
    requestItemId: string;
    availability: OfferAvailability;
    unitPriceCents: number | null;
    brand: string;
    leadTimeDays: number | null;
    notes: string;
  }[];
}

async function parse<T>(response: Response): Promise<T> {
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const data: unknown = isJson ? await response.json() : null;
  if (!response.ok) {
    const problem = (data ?? {}) as Partial<SupplierQuoteError> & { errors?: { message?: string }[] };
    throw {
      code: problem.code ?? 'ERRO',
      title: problem.title ?? 'Não foi possível concluir',
      // erro de validação traz o motivo por campo: é mais útil que o título genérico
      detail: problem.errors?.[0]?.message ?? problem.detail ?? 'Tente de novo em instantes.',
      status: response.status,
    } satisfies SupplierQuoteError;
  }
  return data as T;
}

export const loadSupplierQuote = async (token: string) =>
  parse<PublicSupplierQuote>(await fetch(`${BASE}/${encodeURIComponent(token)}`));

export const sendSupplierResponse = async (token: string, body: SupplierResponseBody) =>
  parse<PublicSupplierQuote>(
    await fetch(`${BASE}/${encodeURIComponent(token)}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
