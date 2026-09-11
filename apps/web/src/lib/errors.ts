import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api-client';

/** Mensagem para o usuário. A API já responde em pt-BR no `detail`. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
    if (err.code === 'RATE_LIMITED') return 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.';
    if (err.status >= 500) return 'Algo deu errado do nosso lado. Tente de novo em instantes.';
    return err.problem?.detail ?? err.problem?.title ?? 'Não foi possível concluir. Tente de novo.';
  }
  return 'Não foi possível concluir. Tente de novo.';
}

/**
 * Leva os erros por campo da API (`body.address.zip`) para o formulário
 * (`address.zip`). Devolve true se algum campo recebeu erro.
 */
export function applyFieldErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): boolean {
  if (!(err instanceof ApiError) || !err.problem?.errors?.length) return false;
  for (const { path, message } of err.problem.errors) {
    const name = path.replace(/^(body|query|params)\./, '');
    setError(name as Path<T>, { type: 'server', message });
  }
  return true;
}
