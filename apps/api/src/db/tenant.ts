import { sql } from 'drizzle-orm';
import type { Database } from './client';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TenantContext {
  organizationId: string;
  userId?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Única porta de entrada para dados de uma oficina.
 *
 * Abre uma transação e define `app.org_id` com `is_local = true`: o valor morre
 * no COMMIT/ROLLBACK e nunca vaza para a próxima requisição que pegar a mesma
 * conexão do pool (compatível com PgBouncer em modo transaction). As policies de
 * RLS leem esse valor; sem ele, nenhuma linha de tenant é visível.
 */
export async function withTenant<T>(
  db: Database,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(ctx.organizationId)) {
    throw new Error('withTenant: organizationId precisa ser um UUID');
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.organizationId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
