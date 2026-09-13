import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { QuoteStatus } from '@oficinaos/shared';
import {
  attachments,
  customers,
  memberships,
  messages,
  notifications,
  quoteApprovals,
  quoteAttachments,
  quoteItems,
  quotes,
  users,
  vehicles,
  workOrderItems,
  workOrders,
} from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type QuoteRow = typeof quotes.$inferSelect;
export type QuoteItemRow = typeof quoteItems.$inferSelect;
export type QuoteApprovalRow = typeof quoteApprovals.$inferSelect;

const sender = alias(users, 'sent_by_user');
const recorder = alias(users, 'recorded_by_user');

const header = {
  quote: quotes,
  workOrderNumber: workOrders.number,
  customerId: customers.id,
  customerName: customers.name,
  /** o link do WhatsApp abre a conversa com o CLIENTE, não com a oficina */
  customerWhatsapp: customers.whatsapp,
  vehiclePlate: vehicles.plate,
  vehicleMake: vehicles.make,
  vehicleModel: vehicles.model,
  sentByName: sender.name,
};

const withRelations = (tx: Tx) =>
  tx
    .select(header)
    .from(quotes)
    .innerJoin(workOrders, and(eq(workOrders.organizationId, quotes.organizationId), eq(workOrders.id, quotes.workOrderId)))
    .innerJoin(customers, and(eq(customers.organizationId, workOrders.organizationId), eq(customers.id, workOrders.customerId)))
    .innerJoin(vehicles, and(eq(vehicles.organizationId, workOrders.organizationId), eq(vehicles.id, workOrders.vehicleId)))
    .leftJoin(sender, eq(sender.id, quotes.sentBy));

export type QuoteHeader = Awaited<ReturnType<typeof withRelations>>[number];

export async function findQuote(tx: Tx, organizationId: string, id: string) {
  const [row] = await withRelations(tx)
    .where(and(eq(quotes.organizationId, organizationId), eq(quotes.id, id)))
    .limit(1);
  return row;
}

/**
 * Busca pelo TOKEN, sem oficina no contexto: é a única porta da página pública.
 * Quem chama precisa rodar fora do RLS de tenant (o token é a credencial).
 */
export async function findByPublicToken(tx: Tx, token: string) {
  const [row] = await withRelations(tx).where(eq(quotes.publicToken, token)).limit(1);
  return row;
}

/** Trava o orçamento: a aprovação inteira acontece com ele preso. */
export async function lockQuote(tx: Tx, id: string) {
  const [row] = await tx.select().from(quotes).where(eq(quotes.id, id)).limit(1).for('update');
  return row;
}

export async function insertQuote(tx: Tx, values: typeof quotes.$inferInsert) {
  const [row] = await tx.insert(quotes).values(values).returning();
  return row!;
}

export async function updateQuote(tx: Tx, id: string, patch: Partial<typeof quotes.$inferInsert>) {
  const [row] = await tx.update(quotes).set(patch).where(eq(quotes.id, id)).returning();
  return row!;
}

/** O orçamento aberto da OS, se houver (o índice parcial garante: no máximo um). */
export async function findOpenQuote(tx: Tx, organizationId: string, workOrderId: string) {
  const [row] = await tx
    .select()
    .from(quotes)
    .where(
      and(eq(quotes.organizationId, organizationId), eq(quotes.workOrderId, workOrderId), eq(quotes.status, 'SENT')),
    )
    .limit(1);
  return row;
}

export async function lastVersionOf(tx: Tx, organizationId: string, workOrderId: string) {
  const [row] = await tx
    .select({ version: sql<number>`coalesce(max(${quotes.version}), 0)::int` })
    .from(quotes)
    .where(and(eq(quotes.organizationId, organizationId), eq(quotes.workOrderId, workOrderId)));
  return row?.version ?? 0;
}

export async function listQuotes(
  tx: Tx,
  organizationId: string,
  options: { status: QuoteStatus | 'open' | 'all'; limit: number; offset: number },
) {
  const where = and(
    eq(quotes.organizationId, organizationId),
    options.status === 'all' ? undefined : options.status === 'open' ? eq(quotes.status, 'SENT') : eq(quotes.status, options.status),
  );
  const rows = await withRelations(tx).where(where).orderBy(desc(quotes.sentAt)).limit(options.limit).offset(options.offset);
  const [counted] = await tx
    .select({ total: count() })
    .from(quotes)
    .innerJoin(workOrders, and(eq(workOrders.organizationId, quotes.organizationId), eq(workOrders.id, quotes.workOrderId)))
    .innerJoin(customers, and(eq(customers.organizationId, workOrders.organizationId), eq(customers.id, workOrders.customerId)))
    .innerJoin(vehicles, and(eq(vehicles.organizationId, workOrders.organizationId), eq(vehicles.id, workOrders.vehicleId)))
    .where(where);
  return { rows, total: counted?.total ?? 0 };
}

// -------------------------------- itens --------------------------------

export async function insertQuoteItems(tx: Tx, values: (typeof quoteItems.$inferInsert)[]) {
  if (!values.length) return [];
  return tx.insert(quoteItems).values(values).returning();
}

export function listQuoteItems(tx: Tx, quoteId: string) {
  return tx.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId)).orderBy(quoteItems.position);
}

/** Os itens em rascunho da OS: é o que o envio congela. */
export function listDraftItems(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select()
    .from(workOrderItems)
    .where(
      and(
        eq(workOrderItems.organizationId, organizationId),
        eq(workOrderItems.workOrderId, workOrderId),
        eq(workOrderItems.approvalStatus, 'DRAFT'),
      ),
    )
    .orderBy(workOrderItems.position);
}

export async function setItemsApprovalStatus(
  tx: Tx,
  organizationId: string,
  itemIds: string[],
  status: 'PENDING' | 'APPROVED' | 'REJECTED',
) {
  if (!itemIds.length) return;
  await tx
    .update(workOrderItems)
    .set({ approvalStatus: status })
    .where(and(eq(workOrderItems.organizationId, organizationId), inArray(workOrderItems.id, itemIds)));
}

// ------------------------------ fotos do item ------------------------------

export async function insertQuoteAttachments(tx: Tx, values: (typeof quoteAttachments.$inferInsert)[]) {
  if (!values.length) return;
  await tx.insert(quoteAttachments).values(values);
}

/** Fotos visíveis ao cliente, já ligadas ao item do orçamento. */
export function listQuotePhotos(tx: Tx, quoteId: string) {
  return tx
    .select({
      id: attachments.id,
      storageKey: attachments.storageKey,
      caption: quoteAttachments.caption,
      quoteItemId: quoteAttachments.quoteItemId,
      position: quoteAttachments.position,
    })
    .from(quoteAttachments)
    .innerJoin(
      attachments,
      and(eq(attachments.organizationId, quoteAttachments.organizationId), eq(attachments.id, quoteAttachments.attachmentId)),
    )
    .where(and(eq(quoteAttachments.quoteId, quoteId), eq(attachments.status, 'READY')))
    .orderBy(quoteAttachments.position);
}

/** Anexos da OS que a oficina marcou como visíveis para o cliente. */
export function listVisibleWorkOrderAttachments(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.organizationId, organizationId),
        eq(attachments.workOrderId, workOrderId),
        eq(attachments.visibleToCustomer, true),
        eq(attachments.status, 'READY'),
      ),
    );
}

// ------------------------------- aprovação -------------------------------

export async function insertApproval(tx: Tx, values: typeof quoteApprovals.$inferInsert) {
  const [row] = await tx.insert(quoteApprovals).values(values).returning();
  return row!;
}

export async function findApproval(tx: Tx, quoteId: string) {
  const [row] = await tx
    .select({ approval: quoteApprovals, recordedByName: recorder.name })
    .from(quoteApprovals)
    .leftJoin(recorder, eq(recorder.id, quoteApprovals.recordedByUserId))
    .where(eq(quoteApprovals.quoteId, quoteId))
    .limit(1);
  return row;
}

// --------------------------- avisos e mensagens ---------------------------

/**
 * Quem recebe o aviso: a equipe que cuida de orçamento (dono, administrador,
 * gerente e atendente). Uma linha por pessoa, porque "lido" é de cada uma.
 */
export async function quoteWatchers(tx: Tx, organizationId: string) {
  return tx
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.isActive, true)));
}

export async function insertNotifications(tx: Tx, values: (typeof notifications.$inferInsert)[]) {
  if (!values.length) return;
  await tx.insert(notifications).values(values);
}

export async function insertMessage(tx: Tx, values: typeof messages.$inferInsert) {
  const [row] = await tx.insert(messages).values(values).returning();
  return row!;
}
