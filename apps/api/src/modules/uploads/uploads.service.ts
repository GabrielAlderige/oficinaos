import { v7 as uuidv7 } from 'uuid';
import { type Attachment, type CreateUploadInput, ErrorCode, type UploadTicket } from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound, validationFailed } from '../../core/errors';
import { blankToNull } from '../../core/normalize';
import type { StorageAction } from '../../integrations/storage/storage';
import { withTenant } from '../../db/tenant';
import * as repo from './uploads.repository';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Fotos e documentos (ARCHITECTURE §11). O fluxo é o mesmo do S3: a API cria o
 * registro e devolve uma URL assinada; o navegador envia o arquivo direto; a
 * API confere tamanho e tipo e marca como pronto. Enquanto não confere, o anexo
 * fica `PENDING_UPLOAD` e não aparece em lugar nenhum.
 */
export class UploadsService {
  constructor(private readonly deps: ServiceDeps) {}

  async create(auth: AuthContext, input: CreateUploadInput, client: ClientInfo): Promise<UploadTicket> {
    if (input.sizeBytes > this.deps.env.UPLOAD_MAX_BYTES) {
      const max = Math.floor(this.deps.env.UPLOAD_MAX_BYTES / (1024 * 1024));
      throw validationFailed([{ path: 'body.sizeBytes', message: `Arquivo grande demais (máximo ${max} MB)` }]);
    }

    const attachmentId = uuidv7();
    const key = `${auth.organizationId}/${input.workOrderId ?? input.vehicleId ?? 'geral'}/${attachmentId}.${EXTENSIONS[input.mimeType] ?? 'bin'}`;

    const row = await withTenant(this.deps.db, auth, async (tx) => {
      const created = await repo.insertAttachment(tx, {
        id: attachmentId,
        organizationId: auth.organizationId,
        workOrderId: input.workOrderId,
        workOrderItemId: input.workOrderItemId,
        inspectionId: input.inspectionId,
        vehicleId: input.vehicleId,
        kind: input.kind,
        storageKey: key,
        fileName: blankToNull(input.fileName),
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        caption: blankToNull(input.caption),
        visibleToCustomer: input.visibleToCustomer,
        uploadedBy: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'attachment.created',
        entityType: 'attachment',
        entityId: created.id,
        metadata: { kind: created.kind, workOrderId: created.workOrderId },
        ...client,
      });
      return created;
    });

    const signed = this.deps.storage.signUpload(key);
    return {
      attachment: this.toDto(row, null),
      uploadUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /** Confere o objeto no storage (tamanho e tipo) e libera o anexo. */
  async complete(auth: AuthContext, id: string): Promise<Attachment> {
    const row = await withTenant(this.deps.db, auth, async (tx) => {
      const attachment = await repo.findAttachment(tx, auth.organizationId, id);
      if (!attachment) throw notFound('Anexo não encontrado.');

      const info = await this.deps.storage.head(attachment.storageKey);
      if (!info) {
        throw new AppError(
          409,
          ErrorCode.UPLOAD_INCOMPLETE,
          'Arquivo não chegou',
          'O arquivo não terminou de subir. Tente enviar de novo.',
        );
      }
      if (info.mimeType !== attachment.mimeType) {
        throw new AppError(
          409,
          ErrorCode.UPLOAD_INCOMPLETE,
          'Arquivo diferente do informado',
          'O tipo do arquivo enviado não é o que foi declarado.',
        );
      }
      if (info.sizeBytes > this.deps.env.UPLOAD_MAX_BYTES) {
        throw new AppError(409, ErrorCode.UPLOAD_INCOMPLETE, 'Arquivo grande demais', 'O arquivo passou do tamanho máximo.');
      }
      return repo.markReady(tx, id, info.sizeBytes);
    });
    return this.toDto(row, this.deps.storage.signDownload(row.storageKey).url);
  }

  async listForWorkOrder(auth: AuthContext, workOrderId: string): Promise<Attachment[]> {
    const rows = await withTenant(this.deps.db, auth, (tx) =>
      repo.listByWorkOrder(tx, auth.organizationId, workOrderId),
    );
    return rows.map((row) => this.toDto(row, row.status === 'READY' ? this.deps.storage.signDownload(row.storageKey).url : null));
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const attachment = await repo.findAttachment(tx, auth.organizationId, id);
      if (!attachment) throw notFound('Anexo não encontrado.');
      await repo.softDeleteAttachment(tx, id);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'attachment.deleted',
        entityType: 'attachment',
        entityId: id,
        metadata: { fileName: attachment.fileName },
        ...client,
      });
    });
  }

  /**
   * Rota pública do objeto: a ASSINATURA da URL é a credencial (uma `<img src>`
   * não manda header de autorização). Chave, ação e validade vêm assinadas.
   */
  verifySignature(input: { key: string; action: StorageAction; expires: number; signature: string }): boolean {
    return this.deps.storage.verify(input);
  }

  read(key: string) {
    return this.deps.storage.get(key);
  }

  write(key: string, body: Buffer, mimeType: string) {
    return this.deps.storage.put(key, body, mimeType);
  }

  private toDto(row: repo.AttachmentRow, url: string | null): Attachment {
    return {
      id: row.id,
      kind: row.kind,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      caption: row.caption,
      visibleToCustomer: row.visibleToCustomer,
      status: row.status,
      url,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
