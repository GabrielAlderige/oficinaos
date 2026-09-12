import { sql } from 'drizzle-orm';
import type { Tx } from '../db/tenant';

/** Chaves de numeração humana por oficina. O orçamento entra na E6. */
export const COUNTER_WORK_ORDER = 'work_order';
export const COUNTER_QUOTE = 'quote';

/**
 * Próximo número humano da oficina ("OS 182"), tirado de
 * `organization_counters` na MESMA transação de quem está criando o registro
 * (docs/DATABASE.md §7).
 *
 * O `on conflict … do update` trava a linha do contador até o fim da transação:
 * duas pessoas abrindo OS no mesmo segundo pegam 182 e 183, nunca o mesmo
 * número (que o índice `UNIQUE (organization_id, number)` recusaria).
 */
export async function nextNumber(tx: Tx, organizationId: string, key: string): Promise<number> {
  const { rows } = await tx.execute<{ value: number }>(sql`
    insert into organization_counters (organization_id, key, value)
    values (${organizationId}, ${key}, 1)
    on conflict (organization_id, key) do update set value = organization_counters.value + 1
    returning value
  `);
  const value = rows[0]?.value;
  if (value === undefined) throw new Error(`Não foi possível gerar o número de ${key}`);
  return Number(value);
}
