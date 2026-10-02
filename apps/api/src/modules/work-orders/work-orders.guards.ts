import { ErrorCode, isEditable, WORK_ORDER_STATUS_LABELS } from '@oficinaos/shared';
import { AppError, notFound } from '../../core/errors';
import type { Tx } from '../../db/tenant';
import * as repo from './work-orders.repository';

/**
 * As travas da OS, usadas pela OS em si e pelo check-in: achar a OS da
 * oficina, travá-la para escrever e recusar a gravação de quem estava com a
 * versão velha na tela.
 */

export function versionConflict() {
  return new AppError(
    409,
    ErrorCode.WORK_ORDER_VERSION_CONFLICT,
    'A OS mudou',
    'Outra pessoa salvou esta OS antes de você. Recarregue para ver o que mudou e tente de novo.',
  );
}

export async function findWorkOrderOrThrow(tx: Tx, organizationId: string, id: string) {
  const header = await repo.findWorkOrder(tx, organizationId, { id });
  if (!header) throw notFound('OS não encontrada.');
  return header;
}

/** Trava a OS, confere se ainda aceita mudança e (quando enviada) a versão. */
export async function lockEditableWorkOrder(tx: Tx, organizationId: string, id: string, version?: number) {
  const order = await repo.lockWorkOrder(tx, organizationId, id);
  if (!order) throw notFound('OS não encontrada.');
  if (!isEditable(order.status)) {
    throw new AppError(
      409,
      ErrorCode.WORK_ORDER_NOT_EDITABLE,
      'OS encerrada',
      `Esta OS está "${WORK_ORDER_STATUS_LABELS[order.status]}" e não aceita mais alterações.`,
    );
  }
  if (version !== undefined && version !== order.version) throw versionConflict();
  return order;
}
