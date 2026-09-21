import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AutomationKey } from '@oficinaos/shared';
import { automationRuns, automationSettings, memberships, notifications, organizations, users } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type AutomationSettingsRow = typeof automationSettings.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;

// ----------------------------- configuração ------------------------------

export async function findSettings(tx: Tx, organizationId: string): Promise<AutomationSettingsRow | undefined> {
  const [row] = await tx
    .select()
    .from(automationSettings)
    .where(eq(automationSettings.organizationId, organizationId))
    .limit(1);
  return row;
}

export async function upsertSettings(
  tx: Tx,
  organizationId: string,
  patch: Partial<typeof automationSettings.$inferInsert>,
): Promise<AutomationSettingsRow> {
  const [row] = await tx
    .insert(automationSettings)
    .values({ organizationId, ...patch })
    .onConflictDoUpdate({ target: automationSettings.organizationId, set: { ...patch, updatedAt: new Date() } })
    .returning();
  return row!;
}

// ------------------------------- execuções -------------------------------

export async function insertRun(tx: Tx, values: typeof automationRuns.$inferInsert): Promise<void> {
  await tx.insert(automationRuns).values(values);
}

/**
 * As últimas execuções, da mais nova para a mais velha. Quem fica com uma por
 * automação é o service — em SQL isso pediria `distinct on`, e o resultado
 * volta sem os tipos do Drizzle (data vira texto, e a tela quebra).
 */
export function recentRuns(tx: Tx, organizationId: string, limite = 40) {
  return tx
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.organizationId, organizationId))
    .orderBy(desc(automationRuns.ranAt))
    .limit(limite);
}

/** Já rodou hoje (no dia da oficina)? É o que impede repetir a automação. */
export async function ranOn(
  tx: Tx,
  organizationId: string,
  key: AutomationKey,
  dia: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.organizationId, organizationId),
        eq(automationRuns.key, key),
        eq(automationRuns.ranOn, dia),
        isNull(automationRuns.error),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// ------------------------- o que cada automação lê -------------------------

/** As oficinas ativas. Só roda com a capacidade do trabalhador de fundo. */
export async function activeOrganizations(tx: Tx): Promise<{ id: string; timezone: string; name: string }[]> {
  return tx
    .select({ id: organizations.id, timezone: organizations.timezone, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.status, 'ACTIVE'));
}

/** Quem recebe aviso no sino: a equipe ativa da oficina. */
export async function watchers(tx: Tx, organizationId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.isActive, true)));
  return rows.map((row) => row.userId);
}

/** O e-mail do dono: é para lá que o resumo vai quando a oficina não cadastrou um. */
export async function ownerEmail(tx: Tx, organizationId: string): Promise<string | null> {
  const [row] = await tx
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.isActive, true),
        eq(memberships.role, 'OWNER'),
      ),
    )
    .limit(1);
  return row?.email ?? null;
}

export async function insertNotifications(tx: Tx, values: (typeof notifications.$inferInsert)[]): Promise<number> {
  if (!values.length) return 0;
  await tx.insert(notifications).values(values);
  return values.length;
}

/** Agendamentos de amanhã que ninguém confirmou ainda. */
export async function agendamentosDeAmanha(
  tx: Tx,
  organizationId: string,
  de: Date,
  ate: Date,
): Promise<{ total: number; primeiro: string | null }> {
  const { rows } = await tx.execute<{ total: string; primeiro: string | null }>(sql`
    select count(*)::text as total, min(customer_name) as primeiro
    from (
      select c.name as customer_name
      from appointments a
      join customers c on c.organization_id = a.organization_id and c.id = a.customer_id
      where a.organization_id = ${organizationId}
        and a.starts_at >= ${de} and a.starts_at < ${ate}
        and a.status = 'SCHEDULED'
    ) agendados
  `);
  return { total: Number(rows[0]?.total ?? 0), primeiro: rows[0]?.primeiro ?? null };
}

/** Orçamentos enviados que ficaram sem decisão pelo prazo da oficina. */
export async function orcamentosParados(
  tx: Tx,
  organizationId: string,
  limite: Date,
): Promise<{ id: string; number: number; workOrderId: string; customerName: string; viewCount: number }[]> {
  const { rows } = await tx.execute<{
    id: string;
    number: number;
    work_order_id: string;
    customer_name: string;
    view_count: number;
  }>(sql`
    select q.id, q.number, q.work_order_id, c.name as customer_name, q.view_count
    from quotes q
    join work_orders w on w.organization_id = q.organization_id and w.id = q.work_order_id
    join customers c on c.organization_id = q.organization_id and c.id = w.customer_id
    where q.organization_id = ${organizationId}
      and q.status = 'SENT'
      and q.sent_at <= ${limite}
    order by q.sent_at asc
    limit 50
  `);
  return rows.map((linha) => ({
    id: linha.id,
    number: linha.number,
    workOrderId: linha.work_order_id,
    customerName: linha.customer_name,
    viewCount: Number(linha.view_count),
  }));
}

/** Os números do resumo do dia, numa consulta só por assunto. */
export async function numerosDoDia(
  tx: Tx,
  organizationId: string,
  hoje: string,
): Promise<{ contatosHoje: number; entregasAtrasadas: number; aReceberVencidoCents: number }> {
  const { rows } = await tx.execute<{ contatos: string; atrasadas: string; vencido: string }>(sql`
    select
      (select count(*) from follow_ups
        where organization_id = ${organizationId} and status = 'PENDING' and due_on <= ${hoje})::text as contatos,
      (select count(*) from work_orders
        where organization_id = ${organizationId} and promised_at is not null and promised_at < now()
          and status not in ('DELIVERED', 'CANCELED'))::text as atrasadas,
      (select coalesce(sum(amount_cents - paid_cents), 0) from financial_entries
        where organization_id = ${organizationId} and direction = 'RECEIVABLE'
          and status in ('OPEN', 'PARTIAL') and due_date < ${hoje})::text as vencido
  `);
  const linha = rows[0];
  return {
    contatosHoje: Number(linha?.contatos ?? 0),
    entregasAtrasadas: Number(linha?.atrasadas ?? 0),
    aReceberVencidoCents: Number(linha?.vencido ?? 0),
  };
}
