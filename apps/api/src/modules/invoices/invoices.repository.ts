import { and, asc, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import type { InvoiceListQuery } from '@oficinaos/shared';
import { customers, invoiceItems, invoices, organizationFiscalSettings, vehicles, workOrders } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceItemRow = typeof invoiceItems.$inferSelect;
export type FiscalSettingsRow = typeof organizationFiscalSettings.$inferSelect;

// ----------------------------- configuração ------------------------------

export async function findFiscalSettings(tx: Tx, organizationId: string): Promise<FiscalSettingsRow | undefined> {
  const [row] = await tx
    .select()
    .from(organizationFiscalSettings)
    .where(eq(organizationFiscalSettings.organizationId, organizationId))
    .limit(1);
  return row;
}

/**
 * Cria a linha na primeira gravação. A oficina que nunca abriu a tela fiscal
 * não tem linha nenhuma, e é isso que faz a tela abrir com tudo em branco em
 * vez de inventar alíquota que ninguém conferiu.
 */
export async function upsertFiscalSettings(
  tx: Tx,
  organizationId: string,
  patch: Partial<typeof organizationFiscalSettings.$inferInsert>,
): Promise<FiscalSettingsRow> {
  const [row] = await tx
    .insert(organizationFiscalSettings)
    .values({ organizationId, ...patch })
    .onConflictDoUpdate({ target: organizationFiscalSettings.organizationId, set: { ...patch, updatedAt: new Date() } })
    .returning();
  return row!;
}

// --------------------------------- notas ---------------------------------

export async function insertInvoice(tx: Tx, values: typeof invoices.$inferInsert): Promise<InvoiceRow> {
  const [row] = await tx.insert(invoices).values(values).returning();
  return row!;
}

export async function insertInvoiceItems(tx: Tx, values: (typeof invoiceItems.$inferInsert)[]): Promise<void> {
  if (values.length) await tx.insert(invoiceItems).values(values);
}

export async function updateInvoice(
  tx: Tx,
  id: string,
  patch: Partial<typeof invoices.$inferInsert>,
): Promise<InvoiceRow> {
  const [row] = await tx.update(invoices).set(patch).where(eq(invoices.id, id)).returning();
  return row!;
}

/** Trava a nota: cancelar duas vezes ao mesmo tempo não pode virar dois cancelamentos. */
export async function lockInvoice(tx: Tx, organizationId: string, id: string): Promise<InvoiceRow | undefined> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.id, id)))
    .limit(1)
    .for('update');
  return row;
}

export async function findByClientRequest(
  tx: Tx,
  organizationId: string,
  clientRequestId: string,
): Promise<InvoiceRow | undefined> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.clientRequestId, clientRequestId)))
    .limit(1);
  return row;
}

/** A nota que vale para a OS: autorizada ou ainda em processamento. */
export async function findLiveByWorkOrder(
  tx: Tx,
  organizationId: string,
  workOrderId: string,
): Promise<InvoiceRow | undefined> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.workOrderId, workOrderId),
        or(eq(invoices.status, 'AUTHORIZED'), eq(invoices.status, 'QUEUED')),
      ),
    )
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  return row;
}

const listagem = (tx: Tx) =>
  tx
    .select({
      invoice: invoices,
      workOrderNumber: workOrders.number,
      customerName: customers.name,
      vehiclePlate: vehicles.plate,
    })
    .from(invoices)
    .innerJoin(workOrders, and(eq(workOrders.organizationId, invoices.organizationId), eq(workOrders.id, invoices.workOrderId)))
    .innerJoin(customers, and(eq(customers.organizationId, invoices.organizationId), eq(customers.id, invoices.customerId)))
    .leftJoin(vehicles, and(eq(vehicles.organizationId, invoices.organizationId), eq(vehicles.id, invoices.vehicleId)));

export type InvoiceJoinedRow = Awaited<ReturnType<typeof listagem>>[number];

export async function findInvoice(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<InvoiceJoinedRow | undefined> {
  const [row] = await listagem(tx)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.id, id)))
    .limit(1);
  return row;
}

export function listItems(tx: Tx, organizationId: string, invoiceId: string) {
  return tx
    .select()
    .from(invoiceItems)
    .where(and(eq(invoiceItems.organizationId, organizationId), eq(invoiceItems.invoiceId, invoiceId)))
    .orderBy(asc(invoiceItems.position));
}

export async function listInvoices(
  tx: Tx,
  organizationId: string,
  query: InvoiceListQuery,
): Promise<{ rows: InvoiceJoinedRow[]; total: number }> {
  const filtros = [eq(invoices.organizationId, organizationId)];
  if (query.status) filtros.push(eq(invoices.status, query.status));
  if (query.from) filtros.push(gte(invoices.createdAt, new Date(`${query.from}T00:00:00`)));
  if (query.to) filtros.push(lte(invoices.createdAt, new Date(`${query.to}T23:59:59.999`)));
  if (query.q) {
    const busca = `%${query.q}%`;
    const numero = Number(query.q.replace(/\D/g, ''));
    const porNumero = Number.isFinite(numero) && numero > 0 ? [eq(workOrders.number, numero)] : [];
    filtros.push(or(ilike(customers.name, busca), ilike(invoices.invoiceNumber, busca), ...porNumero)!);
  }
  const onde = and(...filtros);

  const [{ total } = { total: 0 }] = await tx
    .select({ total: count() })
    .from(invoices)
    .innerJoin(workOrders, and(eq(workOrders.organizationId, invoices.organizationId), eq(workOrders.id, invoices.workOrderId)))
    .innerJoin(customers, and(eq(customers.organizationId, invoices.organizationId), eq(customers.id, invoices.customerId)))
    .where(onde);

  const rows = await listagem(tx)
    .where(onde)
    .orderBy(desc(invoices.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return { rows, total: Number(total) };
}

/** Quanto de ISS a oficina deve no período, só das notas que valem. */
export async function issDoPeriodo(
  tx: Tx,
  organizationId: string,
  de: string,
  ate: string,
): Promise<{ notas: number; totalCents: number; issCents: number }> {
  const { rows } = await tx.execute<{ notas: string; total: string; iss: string }>(sql`
    select count(*)::text as notas,
           coalesce(sum(total_cents), 0)::text as total,
           coalesce(sum(iss_amount_cents) filter (where iss_retained = false), 0)::text as iss
    from invoices
    where organization_id = ${organizationId}
      and status = 'AUTHORIZED'
      and issued_at >= ${`${de}T00:00:00`}::timestamptz
      and issued_at <= ${`${ate}T23:59:59.999`}::timestamptz
  `);
  const linha = rows[0];
  return {
    notas: Number(linha?.notas ?? 0),
    totalCents: Number(linha?.total ?? 0),
    issCents: Number(linha?.iss ?? 0),
  };
}
