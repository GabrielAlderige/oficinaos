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

export const forbidden = (detail?: string) =>
  new AppError(403, ErrorCode.FORBIDDEN, 'Sem permissão para esta ação', detail);

export const conflict = (code: string, detail?: string) =>
  new AppError(409, code, 'Conflito com o estado atual', detail);
