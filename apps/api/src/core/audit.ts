import { activityLogs } from '../db/schema';
import type { Tx } from '../db/tenant';
import type { ClientInfo } from './auth-context';

export interface ActivityInput extends Partial<ClientInfo> {
  organizationId: string;
  actorType?: 'USER' | 'CUSTOMER' | 'SYSTEM';
  actorUserId?: string | null;
  /** ex.: 'member.updated', 'organization.updated' */
  action: string;
  entityType: string;
  entityId: string;
  workOrderId?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  metadata?: Record<string, unknown> | null;
}

/** Grava na trilha de auditoria, na MESMA transação da mudança. */
export async function recordActivity(tx: Tx, input: ActivityInput): Promise<void> {
  await tx.insert(activityLogs).values({ ...input, actorType: input.actorType ?? 'USER' });
}

/** Só os campos que de fato mudaram: {"role": {"from": "MECHANIC", "to": "MANAGER"}}. */
export function diffChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(patch)) {
    if (to === undefined) continue;
    const from = before[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to ?? null)) changes[key] = { from, to: to ?? null };
  }
  return changes;
}
