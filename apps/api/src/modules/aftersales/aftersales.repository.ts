import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { customers, followUps, leads, reviews, vehicles, workOrders } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type FollowUpRow = typeof followUps.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;

// ------------------------------- pós-venda -------------------------------

/** A fila com os dados que a mensagem precisa: cliente, carro e OS. */
export async function listFollowUps(
  tx: Tx,
  organizationId: string,
  options: { status: readonly ('PENDING' | 'DONE' | 'SKIPPED')[]; until?: string; type?: string; limit: number },
) {
  return tx
    .select({
      followUp: followUps,
      customerName: customers.name,
      customerWhatsapp: customers.whatsapp,
      customerPhone: customers.phone,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      vehiclePlate: vehicles.plate,
      workOrderNumber: workOrders.number,
    })
    .from(followUps)
    .innerJoin(customers, and(eq(customers.organizationId, followUps.organizationId), eq(customers.id, followUps.customerId)))
    .leftJoin(vehicles, and(eq(vehicles.organizationId, followUps.organizationId), eq(vehicles.id, followUps.vehicleId)))
    .leftJoin(
      workOrders,
      and(eq(workOrders.organizationId, followUps.organizationId), eq(workOrders.id, followUps.workOrderId)),
    )
    .where(
      and(
        eq(followUps.organizationId, organizationId),
        inArray(followUps.status, [...options.status]),
        options.until ? sql`${followUps.dueOn} <= ${options.until}` : undefined,
        options.type ? eq(followUps.type, options.type as never) : undefined,
        isNull(customers.deletedAt),
      ),
    )
    .orderBy(asc(followUps.dueOn), asc(followUps.createdAt))
    .limit(options.limit);
}

export async function countFollowUps(tx: Tx, organizationId: string, hoje: string, fimDaSemana: string) {
  const { rows } = await tx.execute<{ today: number; late: number; week: number }>(sql`
    select (count(*) filter (where due_date = ${hoje}))::int as today,
           (count(*) filter (where due_date < ${hoje}))::int as late,
           (count(*) filter (where due_date <= ${fimDaSemana}))::int as week
    from (select due_on as due_date from follow_ups
          where organization_id = ${organizationId} and status = 'PENDING') fila
  `);
  return rows[0] ?? { today: 0, late: 0, week: 0 };
}

export async function findFollowUp(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(followUps)
    .where(and(eq(followUps.organizationId, organizationId), eq(followUps.id, id)))
    .limit(1);
  return row;
}

export async function updateFollowUp(tx: Tx, id: string, patch: Partial<typeof followUps.$inferInsert>) {
  const [row] = await tx.update(followUps).set(patch).where(eq(followUps.id, id)).returning();
  return row!;
}

/**
 * A fila é recalculada a cada abertura da tela; `dedupe_key` é o que impede a
 * mesma conversa de nascer de novo. `onConflictDoNothing` é a trava, não um
 * detalhe: sem ela, abrir a tela duas vezes duplicaria o dia inteiro.
 */
export async function insertFollowUps(tx: Tx, values: (typeof followUps.$inferInsert)[]): Promise<number> {
  if (!values.length) return 0;
  const criados = await tx
    .insert(followUps)
    .values(values)
    .onConflictDoNothing({ target: [followUps.organizationId, followUps.dedupeKey] })
    .returning({ id: followUps.id });
  return criados.length;
}

/** Candidatos a pós-venda: OS entregue há N dias, com cliente e carro. */
export async function candidatosPosVenda(tx: Tx, organizationId: string, de: Date, ate: Date) {
  const { rows } = await tx.execute<{
    work_order_id: string;
    number: number;
    customer_id: string;
    vehicle_id: string;
    delivered_on: string;
    servico: string | null;
  }>(sql`
    select w.id as work_order_id, w.number, w.customer_id, w.vehicle_id,
           to_char(w.delivered_at, 'YYYY-MM-DD') as delivered_on,
           (select i.description from work_order_items i
            where i.organization_id = w.organization_id and i.work_order_id = w.id and i.type = 'SERVICE'
            order by i.position limit 1) as servico
    from work_orders w
    where w.organization_id = ${organizationId}
      and w.status = 'DELIVERED'
      and w.delivered_at >= ${de} and w.delivered_at < ${ate}
  `);
  return rows;
}

/** Candidatos a revisão: serviço com intervalo, feito no carro, sem repetição depois. */
export async function candidatosRevisao(tx: Tx, organizationId: string) {
  const { rows } = await tx.execute<{
    customer_id: string;
    vehicle_id: string;
    work_order_id: string;
    service_id: string;
    service_name: string;
    interval_km: number | null;
    interval_months: number | null;
    feito_em: string;
    km_no_servico: number | null;
    km_atual: number | null;
  }>(sql`
    select distinct on (w.vehicle_id, s.id)
           w.customer_id, w.vehicle_id, w.id as work_order_id,
           s.id as service_id, s.name as service_name,
           s.interval_km, s.interval_months,
           to_char(w.completed_at, 'YYYY-MM-DD') as feito_em,
           w.odometer_km as km_no_servico,
           v.odometer_km as km_atual
    from work_order_items i
    join work_orders w on w.organization_id = i.organization_id and w.id = i.work_order_id
    join services s on s.organization_id = i.organization_id and s.id = i.service_id
    join vehicles v on v.organization_id = w.organization_id and v.id = w.vehicle_id
    where i.organization_id = ${organizationId}
      and i.type = 'SERVICE'
      and i.approval_status <> 'REJECTED'
      and w.completed_at is not null
      and w.status <> 'CANCELED'
      and (s.interval_km is not null or s.interval_months is not null)
      and v.deleted_at is null
    order by w.vehicle_id, s.id, w.completed_at desc
  `);
  return rows;
}

/** Clientes que não voltam há N meses (e que já vieram alguma vez). */
export async function candidatosSemVoltar(tx: Tx, organizationId: string, limite: Date) {
  const { rows } = await tx.execute<{ customer_id: string; vehicle_id: string | null; ultima: string }>(sql`
    select w.customer_id,
           (array_agg(w.vehicle_id order by w.completed_at desc))[1] as vehicle_id,
           to_char(max(w.completed_at), 'YYYY-MM-DD') as ultima
    from work_orders w
    join customers c on c.organization_id = w.organization_id and c.id = w.customer_id
    where w.organization_id = ${organizationId}
      and w.status <> 'CANCELED'
      and w.completed_at is not null
      and c.deleted_at is null
    group by w.customer_id
    having max(w.completed_at) < ${limite}
  `);
  return rows;
}

// ------------------------------- avaliações -------------------------------

export async function insertReview(tx: Tx, values: typeof reviews.$inferInsert) {
  const [row] = await tx.insert(reviews).values(values).returning();
  return row!;
}

export async function findReviewByWorkOrder(tx: Tx, organizationId: string, workOrderId: string) {
  const [row] = await tx
    .select()
    .from(reviews)
    .where(and(eq(reviews.organizationId, organizationId), eq(reviews.workOrderId, workOrderId)))
    .limit(1);
  return row;
}

/** Sem contexto de oficina: a policy `review_by_token` libera só esta linha. */
export async function findReviewByToken(tx: Tx, tokenHash: string) {
  const [row] = await tx.select().from(reviews).where(eq(reviews.tokenHash, tokenHash)).limit(1);
  return row;
}

export async function updateReview(tx: Tx, id: string, patch: Partial<typeof reviews.$inferInsert>) {
  const [row] = await tx.update(reviews).set(patch).where(eq(reviews.id, id)).returning();
  return row!;
}

export async function reviewSummary(tx: Tx, organizationId: string) {
  const { rows } = await tx.execute<{ rating: number; total: number }>(sql`
    select rating, count(*)::int as total
    from reviews
    where organization_id = ${organizationId} and rating is not null
    group by rating
    order by rating
  `);
  const [pendentes] = await tx
    .select({ total: count() })
    .from(reviews)
    .where(and(eq(reviews.organizationId, organizationId), isNull(reviews.submittedAt)));
  const ultimas = await tx
    .select({
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      submittedAt: reviews.submittedAt,
      customerName: customers.name,
      workOrderNumber: workOrders.number,
    })
    .from(reviews)
    .innerJoin(customers, and(eq(customers.organizationId, reviews.organizationId), eq(customers.id, reviews.customerId)))
    .innerJoin(workOrders, and(eq(workOrders.organizationId, reviews.organizationId), eq(workOrders.id, reviews.workOrderId)))
    .where(and(eq(reviews.organizationId, organizationId), sql`${reviews.submittedAt} is not null`))
    .orderBy(desc(reviews.submittedAt))
    .limit(10);
  return { distribuicao: rows, pendentes: pendentes?.total ?? 0, ultimas };
}

// ---------------------------------- CRM ----------------------------------

export async function listLeads(tx: Tx, organizationId: string, options: { q?: string; limitPorEtapa: number }) {
  return tx
    .select({ lead: leads, customerName: customers.name })
    .from(leads)
    .leftJoin(customers, and(eq(customers.organizationId, leads.organizationId), eq(customers.id, leads.customerId)))
    .where(
      and(
        eq(leads.organizationId, organizationId),
        options.q
          ? sql`(immutable_unaccent(${leads.name}) ilike immutable_unaccent(${`%${options.q}%`})
                 or coalesce(${leads.phone}, '') like ${`%${options.q.replace(/\D/g, '')}%`}
                 or immutable_unaccent(coalesce(${leads.vehicleDesc}, '')) ilike immutable_unaccent(${`%${options.q}%`}))`
          : undefined,
      ),
    )
    .orderBy(desc(leads.updatedAt), desc(leads.createdAt))
    .limit(options.limitPorEtapa * 6);
}

export async function findLead(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select({ lead: leads, customerName: customers.name })
    .from(leads)
    .leftJoin(customers, and(eq(customers.organizationId, leads.organizationId), eq(customers.id, leads.customerId)))
    .where(and(eq(leads.organizationId, organizationId), eq(leads.id, id)))
    .limit(1);
  return row;
}

export async function insertLead(tx: Tx, values: typeof leads.$inferInsert) {
  const [row] = await tx.insert(leads).values(values).returning();
  return row!;
}

export async function updateLead(tx: Tx, id: string, patch: Partial<typeof leads.$inferInsert>) {
  const [row] = await tx.update(leads).set(patch).where(eq(leads.id, id)).returning();
  return row!;
}
