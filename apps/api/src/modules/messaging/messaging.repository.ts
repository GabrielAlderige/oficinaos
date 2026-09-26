import { and, desc, eq, sql } from 'drizzle-orm';
import type { MessageTemplateKey } from '@oficinaos/shared';
import { conversations, customers, messages, messageTemplates, messagingChannels, users, vehicles } from '../../db/schema';
import type { Tx } from '../../db/tenant';

export type ChannelRow = typeof messagingChannels.$inferSelect;
export type TemplateRow = typeof messageTemplates.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

// ------------------------------- o canal ---------------------------------

export async function findChannel(tx: Tx, organizationId: string): Promise<ChannelRow | undefined> {
  const [row] = await tx
    .select()
    .from(messagingChannels)
    .where(eq(messagingChannels.organizationId, organizationId))
    .limit(1);
  return row;
}

/** Pelo id do número na Meta, com a capacidade do webhook (`withPhoneRef`). */
export async function findChannelByPhoneId(tx: Tx, phoneNumberId: string): Promise<ChannelRow | undefined> {
  const [row] = await tx
    .select()
    .from(messagingChannels)
    .where(eq(messagingChannels.phoneNumberId, phoneNumberId))
    .limit(1);
  return row;
}

export async function upsertChannel(
  tx: Tx,
  organizationId: string,
  patch: Partial<typeof messagingChannels.$inferInsert>,
): Promise<ChannelRow> {
  const [row] = await tx
    .insert(messagingChannels)
    .values({ organizationId, ...patch })
    .onConflictDoUpdate({ target: messagingChannels.organizationId, set: { ...patch, updatedAt: new Date() } })
    .returning();
  return row!;
}

// ------------------------------ os modelos --------------------------------

export function listTemplates(tx: Tx, organizationId: string) {
  return tx.select().from(messageTemplates).where(eq(messageTemplates.organizationId, organizationId));
}

export async function upsertTemplate(
  tx: Tx,
  organizationId: string,
  key: MessageTemplateKey,
  patch: Partial<typeof messageTemplates.$inferInsert>,
): Promise<TemplateRow> {
  const [row] = await tx
    .insert(messageTemplates)
    .values({ organizationId, key, ...patch })
    .onConflictDoUpdate({
      target: [messageTemplates.organizationId, messageTemplates.key],
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

// ------------------------------ a conversa --------------------------------

export async function findConversation(tx: Tx, organizationId: string, customerId: string) {
  const [row] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.customerId, customerId)))
    .limit(1);
  return row;
}

export async function upsertConversation(
  tx: Tx,
  organizationId: string,
  customerId: string,
  patch: Partial<typeof conversations.$inferInsert>,
) {
  const [row] = await tx
    .insert(conversations)
    .values({ organizationId, customerId, ...patch })
    .onConflictDoUpdate({
      target: [conversations.organizationId, conversations.customerId],
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

/** Soma um não lido sem correr atrás do valor anterior (dois avisos ao mesmo tempo). */
export async function bumpUnread(tx: Tx, organizationId: string, customerId: string): Promise<void> {
  await tx
    .update(conversations)
    .set({ unread: sql`${conversations.unread} + 1` })
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.customerId, customerId)));
}

export async function clearUnread(tx: Tx, organizationId: string, customerId: string): Promise<void> {
  await tx
    .update(conversations)
    .set({ unread: 0 })
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.customerId, customerId)));
}

export function listConversations(tx: Tx, organizationId: string, limite = 60) {
  return tx
    .select({ conversa: conversations, customerName: customers.name, phone: customers.whatsapp, phone2: customers.phone })
    .from(conversations)
    .innerJoin(customers, and(eq(customers.organizationId, conversations.organizationId), eq(customers.id, conversations.customerId)))
    .where(eq(conversations.organizationId, organizationId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limite);
}

// ----------------------------- as mensagens -------------------------------

export function listMessages(tx: Tx, organizationId: string, customerId: string, limite = 100) {
  return tx
    .select({ mensagem: messages, sentByName: users.name })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.sentBy))
    .where(and(eq(messages.organizationId, organizationId), eq(messages.customerId, customerId)))
    .orderBy(desc(messages.createdAt))
    .limit(limite);
}

export async function insertMessage(tx: Tx, values: typeof messages.$inferInsert): Promise<MessageRow> {
  const [row] = await tx.insert(messages).values(values).returning();
  return row!;
}

export async function findByClientRequest(
  tx: Tx,
  organizationId: string,
  clientRequestId: string,
): Promise<MessageRow | undefined> {
  const [row] = await tx
    .select()
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), eq(messages.clientRequestId, clientRequestId)))
    .limit(1);
  return row;
}

/**
 * Atualiza a situação pelo id do WhatsApp. Devolve `false` quando a mensagem
 * não é nossa — o aviso chega para tudo que sai do número, inclusive o que a
 * oficina mandou pelo celular.
 */
export async function updateStatusByProviderId(
  tx: Tx,
  organizationId: string,
  providerMessageId: string,
  patch: { status: typeof messages.$inferInsert.status; failureReason?: string | null },
): Promise<boolean> {
  const atualizadas = await tx
    .update(messages)
    .set(patch)
    .where(and(eq(messages.organizationId, organizationId), eq(messages.providerMessageId, providerMessageId)))
    .returning({ id: messages.id });
  return atualizadas.length > 0;
}

/** O cliente daquele telefone. É assim que a resposta acha a conversa. */
export async function findCustomerByPhone(tx: Tx, organizationId: string, digitos: string) {
  const { rows } = await tx.execute<{ id: string; name: string }>(sql`
    select id, name
    from customers
    where organization_id = ${organizationId}
      and deleted_at is null
      and regexp_replace(coalesce(whatsapp, phone, ''), '\\D', '', 'g') like ${'%' + digitos.slice(-8)}
    order by updated_at desc nulls last
    limit 1
  `);
  return rows[0];
}

/** O veículo mais recente do cliente: entra no texto dos modelos. */
export async function lastVehicle(tx: Tx, organizationId: string, customerId: string) {
  const [row] = await tx
    .select({ make: vehicles.make, model: vehicles.model, plate: vehicles.plate })
    .from(vehicles)
    .where(and(eq(vehicles.organizationId, organizationId), eq(vehicles.customerId, customerId)))
    .orderBy(desc(vehicles.updatedAt))
    .limit(1);
  return row;
}

/** O mesmo aviso chega duas vezes quando a Meta não recebe o 200. */
export async function findByProviderId(
  tx: Tx,
  organizationId: string,
  providerMessageId: string,
): Promise<MessageRow | undefined> {
  const [row] = await tx
    .select()
    .from(messages)
    .where(and(eq(messages.organizationId, organizationId), eq(messages.providerMessageId, providerMessageId)))
    .limit(1);
  return row;
}
