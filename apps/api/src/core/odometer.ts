import { ErrorCode } from '@oficinaos/shared';
import { AppError } from './errors';
import { formatKm } from './normalize';

/**
 * Quilometragem que diminui é quase sempre erro de digitação, e km errado
 * estraga o "próxima troca em X km". A regra é a mesma do cadastro do veículo
 * (E3): recusa com 422 e pede confirmação explícita de quem está corrigindo.
 */
export function assertOdometerNotDecreasing(input: {
  previousKm: number | null;
  nextKm: number;
  confirmed: boolean;
  /** caminho do campo na resposta de erro (ex.: 'body.odometerKm') */
  field: string;
}): void {
  const { previousKm, nextKm, confirmed, field } = input;
  if (previousKm === null || nextKm >= previousKm || confirmed) return;
  throw new AppError(
    422,
    ErrorCode.ODOMETER_DECREASE,
    'Quilometragem menor que a anterior',
    `A última quilometragem registrada é ${formatKm(previousKm)}. Confirme se quer corrigir para ${formatKm(nextKm)}.`,
    [{ path: field, message: `Menor que a última registrada (${formatKm(previousKm)})` }],
  );
}
