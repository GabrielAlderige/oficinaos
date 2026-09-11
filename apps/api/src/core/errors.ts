import { ErrorCode } from '@oficinaos/shared';

export interface FieldError {
  path: string;
  message: string;
}

/**
 * Erro de domínio com status HTTP e código estável. Tudo o que a API
 * responde como erro passa por aqui e sai como problem+json.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? title);
    this.name = 'AppError';
  }
}

export const notFound = (detail?: string) =>
  new AppError(404, ErrorCode.NOT_FOUND, 'Recurso não encontrado', detail);

export const unauthorized = (detail = 'Faça login para continuar.') =>
  new AppError(401, ErrorCode.UNAUTHORIZED, 'Não autenticado', detail);

export const forbidden = (detail = 'Seu papel nesta oficina não permite esta ação.') =>
  new AppError(403, ErrorCode.FORBIDDEN, 'Sem permissão para esta ação', detail);

export const conflict = (code: string, detail?: string) =>
  new AppError(409, code, 'Conflito com o estado atual', detail);

export const validationFailed = (errors: FieldError[]) =>
  new AppError(400, ErrorCode.VALIDATION_FAILED, 'Dados inválidos', 'Confira os campos destacados.', errors);

/** Código SQLSTATE do Postgres, atravessando o embrulho do Drizzle. */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  if (typeof e?.cause?.code === 'string') return e.cause.code;
  if (typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  return undefined;
}

export const UNIQUE_VIOLATION = '23505';

/** Nome da constraint violada (ex.: 'vehicles_org_plate_unique'). */
export function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: unknown; cause?: { constraint?: unknown } } | null;
  if (typeof e?.cause?.constraint === 'string') return e.cause.constraint;
  return typeof e?.constraint === 'string' ? e.constraint : undefined;
}
