import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { users, workOrderItemTimers } from '../../db/schema';
import type { Tx } from '../../db/tenant';

/**
 * Cronômetro por item de serviço (E15). Cada volta é uma linha: o mecânico
 * para para almoçar, a peça não chegou, o serviço continua amanhã — e o tempo
 * real do item é a SOMA das voltas, não a diferença entre a primeira e a
 * última. O relatório de mecânicos compara esse total com o estimado.
 */

const mecanico = alias(users, 'timer_mechanic');

export interface TempoDoItem {
  /** minutos já fechados */
  minutes: number;
  /** quando a volta em andamento começou (null se não há nenhuma) */
  runningSince: string | null;
  runningMechanicName: string | null;
}

/** Os tempos dos itens de uma OS, já somados. */
export async function readItemTimes(
  tx: Tx,
  organizationId: string,
  itemIds: string[],
): Promise<Map<string, TempoDoItem>> {
  if (!itemIds.length) return new Map();
  const linhas = await tx
    .select({
      itemId: workOrderItemTimers.workOrderItemId,
      startedAt: workOrderItemTimers.startedAt,
      minutes: workOrderItemTimers.minutes,
      mechanicName: mecanico.name,
    })
    .from(workOrderItemTimers)
    .leftJoin(mecanico, eq(mecanico.id, workOrderItemTimers.mechanicUserId))
    .where(
      and(
        eq(workOrderItemTimers.organizationId, organizationId),
        inArray(workOrderItemTimers.workOrderItemId, itemIds),
      ),
    );

  const porItem = new Map<string, TempoDoItem>();
  for (const linha of linhas) {
    const atual = porItem.get(linha.itemId) ?? { minutes: 0, runningSince: null, runningMechanicName: null };
    if (linha.minutes === null) {
      atual.runningSince = linha.startedAt.toISOString();
      atual.runningMechanicName = linha.mechanicName;
    } else {
      atual.minutes += linha.minutes;
    }
    porItem.set(linha.itemId, atual);
  }
  return porItem;
}

/** A volta aberta deste mecânico, em qualquer OS: só pode haver uma. */
export async function findRunningTimer(tx: Tx, organizationId: string, mechanicUserId: string) {
  const [row] = await tx
    .select()
    .from(workOrderItemTimers)
    .where(
      and(
        eq(workOrderItemTimers.organizationId, organizationId),
        eq(workOrderItemTimers.mechanicUserId, mechanicUserId),
        isNull(workOrderItemTimers.stoppedAt),
      ),
    )
    .limit(1)
    .for('update');
  return row;
}

export async function startTimer(tx: Tx, values: typeof workOrderItemTimers.$inferInsert) {
  const [row] = await tx.insert(workOrderItemTimers).values(values).returning();
  return row!;
}

/**
 * Fecha a volta. Os minutos são arredondados **para cima**, com o mínimo de 1:
 * serviço de 40 segundos que vira zero faria o relatório mentir para menos.
 */
export async function stopTimer(tx: Tx, id: string, agora: Date) {
  const [row] = await tx
    .update(workOrderItemTimers)
    .set({
      stoppedAt: agora,
      minutes: sql`greatest(1, ceil(extract(epoch from (${agora} - started_at)) / 60))::int`,
    })
    .where(eq(workOrderItemTimers.id, id))
    .returning();
  return row!;
}

/** As voltas de um item, da mais recente para a mais antiga. */
export async function listItemTimers(tx: Tx, organizationId: string, itemId: string) {
  return tx
    .select({ timer: workOrderItemTimers, mechanicName: mecanico.name })
    .from(workOrderItemTimers)
    .leftJoin(mecanico, eq(mecanico.id, workOrderItemTimers.mechanicUserId))
    .where(
      and(eq(workOrderItemTimers.organizationId, organizationId), eq(workOrderItemTimers.workOrderItemId, itemId)),
    )
    .orderBy(desc(workOrderItemTimers.startedAt));
}
