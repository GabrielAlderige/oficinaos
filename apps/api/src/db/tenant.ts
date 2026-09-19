import { sql } from 'drizzle-orm';
import type { Database } from './client';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TenantContext {
  organizationId: string;
  userId?: string | null;
}

/** Únicas variáveis de sessão que as policies de RLS leem (migrations 0001 e 0003). */
type ContextKey =
  | 'app.org_id'
  | 'app.user_id'
  | 'app.invite_token_hash'
  | 'app.quote_token'
  | 'app.supplier_token_hash'
  | 'app.review_token_hash'
  | 'app.tracking_token';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string) {
  if (!UUID.test(value)) throw new Error(`${label} precisa ser um UUID`);
}

/**
 * Abre uma transação e define as variáveis com `is_local = true`: o valor morre
 * no COMMIT/ROLLBACK e nunca vaza para a próxima requisição que pegar a mesma
 * conexão do pool (compatível com PgBouncer em modo transaction).
 */
async function withDbContext<T>(
  db: Database,
  settings: Partial<Record<ContextKey, string>>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const entries = Object.entries(settings);
    if (entries.length) {
      const calls = entries.map(([key, value]) => sql`set_config(${key}, ${value}, true)`);
      await tx.execute(sql`select ${sql.join(calls, sql`, `)}`);
    }
    return fn(tx);
  });
}

/**
 * Porta de entrada para dados de uma oficina. As policies de RLS leem
 * `app.org_id`; sem ele, nenhuma linha de tenant é visível.
 */
export async function withTenant<T>(db: Database, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(ctx.organizationId, 'withTenant: organizationId');
  if (ctx.userId) assertUuid(ctx.userId, 'withTenant: userId');
  return withDbContext(db, { 'app.org_id': ctx.organizationId, 'app.user_id': ctx.userId ?? '' }, fn);
}

/**
 * Sem oficina no contexto: só enxerga o que as policies `own_memberships` e
 * `member_organizations` liberam para o próprio usuário (login, seletor de oficina).
 */
export async function withUser<T>(db: Database, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(userId, 'withUser: userId');
  return withDbContext(db, { 'app.user_id': userId }, fn);
}

/** Capacidade do link de convite: libera ler só o convite cujo hash foi apresentado. */
export function withInviteToken<T>(db: Database, tokenHash: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDbContext(db, { 'app.invite_token_hash': tokenHash }, fn);
}

/**
 * Capacidade do link do orçamento: libera ler AQUELE orçamento (e seus itens,
 * fotos e decisão) para quem apresenta o token, sem sessão e sem oficina no
 * contexto. Mesmo desenho do convite: o token é a capacidade, não uma chave da
 * oficina inteira — a escrita da aprovação continua rodando com `withTenant`.
 */
export function withQuoteToken<T>(db: Database, token: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDbContext(db, { 'app.quote_token': token }, fn);
}

/**
 * Capacidade do link do fornecedor (E11): quem apresenta o HASH do token lê só
 * aquele convite, para a API descobrir a oficina. Nada além disso.
 */
export function withSupplierToken<T>(db: Database, tokenHash: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error('withSupplierToken: esperado o hash sha256 do token');
  return withDbContext(db, { 'app.supplier_token_hash': tokenHash }, fn);
}

/**
 * Capacidade do link da avaliação (E16): quem apresenta o HASH do token lê só
 * aquela avaliação, para a API descobrir a oficina. Mesmo desenho do orçamento.
 */
export function withReviewToken<T>(db: Database, tokenHash: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error('withReviewToken: esperado o hash sha256 do token');
  return withDbContext(db, { 'app.review_token_hash': tokenHash }, fn);
}

/**
 * Capacidade do link "acompanhe seu veículo" (E17): o token lê só aquela OS,
 * para a API descobrir a oficina. Mesmo desenho do orçamento.
 */
export function withTrackingToken<T>(db: Database, token: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDbContext(db, { 'app.tracking_token': token }, fn);
}

/** Tabelas globais (users, sessions, plans, password_reset_tokens): sem contexto de tenant. */
export function withoutTenant<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDbContext(db, {}, fn);
}
