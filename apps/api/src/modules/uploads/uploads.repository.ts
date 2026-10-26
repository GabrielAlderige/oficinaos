import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { VIDEO_UNANSWERED_DAYS } from '@oficinaos/shared';
import { attachments, quoteAttachments, workOrderItems, workOrders } from '../../db/schema';
import type { Tx } from '../../db/tenant';

const DIA_MS = 24 * 60 * 60 * 1000;

export type AttachmentRow = typeof attachments.$inferSelect;

const alive = (organizationId: string) =>
  and(eq(attachments.organizationId, organizationId), isNull(attachments.deletedAt));

export async function insertAttachment(tx: Tx, values: typeof attachments.$inferInsert) {
  const [row] = await tx.insert(attachments).values(values).returning();
  return row!;
}

export async function findAttachment(tx: Tx, organizationId: string, id: string) {
  const [row] = await tx
    .select()
    .from(attachments)
    .where(and(alive(organizationId), eq(attachments.id, id)))
    .limit(1);
  return row;
}

export async function markReady(tx: Tx, id: string, sizeBytes: number) {
  const [row] = await tx
    .update(attachments)
    .set({ status: 'READY', sizeBytes })
    .where(eq(attachments.id, id))
    .returning();
  return row!;
}

export async function softDeleteAttachment(tx: Tx, id: string) {
  await tx.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, id));
}

export function listByWorkOrder(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select()
    .from(attachments)
    .where(and(alive(organizationId), eq(attachments.workOrderId, workOrderId)))
    .orderBy(desc(attachments.createdAt));
}

// ------------------------------- vídeo (E45) -------------------------------

export async function markProcessing(tx: Tx, id: string, sizeBytes: number) {
  const [row] = await tx
    .update(attachments)
    .set({ status: 'PROCESSING', sizeBytes })
    .where(eq(attachments.id, id))
    .returning();
  return row!;
}

/** Convertido: o anexo passa a apontar para o MP4, e o original sai de cena. */
export async function markVideoReady(
  tx: Tx,
  id: string,
  values: { storageKey: string; posterStorageKey: string; sizeBytes: number; durationSeconds: number },
) {
  const [row] = await tx
    .update(attachments)
    .set({ ...values, status: 'READY', mimeType: 'video/mp4' })
    .where(and(eq(attachments.id, id), eq(attachments.status, 'PROCESSING')))
    .returning();
  return row;
}

export async function setStatus(tx: Tx, id: string, status: AttachmentRow['status']) {
  await tx.update(attachments).set({ status }).where(eq(attachments.id, id));
}

export function listProcessingVideos(tx: Tx, organizationId: string) {
  return tx
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        eq(attachments.organizationId, organizationId),
        eq(attachments.kind, 'VIDEO'),
        eq(attachments.status, 'PROCESSING'),
        isNull(attachments.deletedAt),
      ),
    );
}

/**
 * Os vídeos cujo arquivo já pode sair do disco:
 * - prontos, com o prazo de 7 dias depois da resposta vencido;
 * - prontos, sem resposta nenhuma há 30 dias (o orçamento nunca saiu, venceu
 *   ou a OS foi cancelada);
 * - o envio que começou e nunca terminou, depois de um dia.
 */
export function listVideosToPurge(tx: Tx, organizationId: string, agora: Date) {
  const semResposta = new Date(agora.getTime() - VIDEO_UNANSWERED_DAYS * DIA_MS);
  const envioAbandonado = new Date(agora.getTime() - DIA_MS);
  return tx
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.organizationId, organizationId),
        eq(attachments.kind, 'VIDEO'),
        or(
          and(eq(attachments.status, 'READY'), lte(attachments.expiresAt, agora)),
          and(eq(attachments.status, 'READY'), isNull(attachments.expiresAt), lte(attachments.createdAt, semResposta)),
          and(eq(attachments.status, 'PENDING_UPLOAD'), lte(attachments.createdAt, envioAbandonado)),
        ),
      ),
    );
}

/**
 * O cliente respondeu: os vídeos daquele orçamento ganham o prazo de 7 dias.
 * Só quem ainda não tem prazo — um vídeo que já foi em outro orçamento
 * respondido não ganha mais tempo.
 */
export async function setVideoDeadlineForQuote(tx: Tx, organizationId: string, quoteId: string, expiresAt: Date) {
  await tx
    .update(attachments)
    .set({ expiresAt })
    .where(
      and(
        eq(attachments.organizationId, organizationId),
        eq(attachments.kind, 'VIDEO'),
        isNull(attachments.expiresAt),
        inArray(
          attachments.id,
          tx
            .select({ id: quoteAttachments.attachmentId })
            .from(quoteAttachments)
            .where(and(eq(quoteAttachments.organizationId, organizationId), eq(quoteAttachments.quoteId, quoteId))),
        ),
      ),
    );
}

/** O item é desta OS? (a FK só garante que é da mesma oficina) */
export async function itemBelongsToWorkOrder(tx: Tx, organizationId: string, workOrderId: string, itemId: string) {
  const [row] = await tx
    .select({ id: workOrderItems.id })
    .from(workOrderItems)
    .where(
      and(
        eq(workOrderItems.organizationId, organizationId),
        eq(workOrderItems.workOrderId, workOrderId),
        eq(workOrderItems.id, itemId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function workOrderExists(tx: Tx, organizationId: string, workOrderId: string) {
  const [row] = await tx
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.id, workOrderId)))
    .limit(1);
  return Boolean(row);
}

// ------------------------- espaço do plano (E46) -------------------------

/**
 * Quanto a oficina ocupa no servidor, em bytes: fotos, documentos e vídeos que
 * existem. O vídeo convertendo conta pelo original (é o que está no disco). O
 * envio que começou há menos de um dia conta também — é espaço reservado; o
 * que ficou parado mais que isso foi abandonado e não pesa para sempre.
 * Apagado, vencido e o que falhou não contam.
 */
export async function storageUsedBytes(tx: Tx, organizationId: string, agora = new Date()) {
  const envioRecente = new Date(agora.getTime() - DIA_MS);
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)` })
    .from(attachments)
    .where(
      and(
        alive(organizationId),
        or(
          inArray(attachments.status, ['READY', 'PROCESSING']),
          and(eq(attachments.status, 'PENDING_UPLOAD'), gt(attachments.createdAt, envioRecente)),
        ),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * Os vídeos que o cliente vê na página "acompanhar" (E46): os prontos que a
 * oficina deixou marcados para ele, do mais antigo ao mais novo.
 */
export function listCustomerVideosForWorkOrder(tx: Tx, organizationId: string, workOrderId: string) {
  return tx
    .select({
      id: attachments.id,
      storageKey: attachments.storageKey,
      posterStorageKey: attachments.posterStorageKey,
      caption: attachments.caption,
      durationSeconds: attachments.durationSeconds,
      expiresAt: attachments.expiresAt,
      itemDescription: workOrderItems.description,
    })
    .from(attachments)
    .leftJoin(
      workOrderItems,
      and(eq(workOrderItems.organizationId, attachments.organizationId), eq(workOrderItems.id, attachments.workOrderItemId)),
    )
    .where(
      and(
        alive(organizationId),
        eq(attachments.workOrderId, workOrderId),
        eq(attachments.kind, 'VIDEO'),
        eq(attachments.status, 'READY'),
        eq(attachments.visibleToCustomer, true),
      ),
    )
    .orderBy(attachments.createdAt);
}
