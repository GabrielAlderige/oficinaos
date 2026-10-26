import { v7 as uuidv7 } from 'uuid';
import type { Readable } from 'node:stream';
import {
  type Attachment,
  type CreateUploadInput,
  type CreateVideoUploadInput,
  ErrorCode,
  type UploadTicket,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound, validationFailed } from '../../core/errors';
import { blankToNull } from '../../core/normalize';
import type { ByteRange, StorageAction, StorageProvider } from '../../integrations/storage/storage';
import { withTenant } from '../../db/tenant';
import { assertCabeNoEspaco } from './storage-quota';
import * as repo from './uploads.repository';
import type { VideoProcessor, VideosService } from './videos.service';

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
  constructor(
    private readonly deps: ServiceDeps,
    private readonly videos: VideosService,
    private readonly processor: VideoProcessor,
  ) {}

  /** Vídeo na OS (E45): mesmo ticket da foto, numa chave própria. */
  async createVideo(auth: AuthContext, input: CreateVideoUploadInput, client: ClientInfo): Promise<UploadTicket> {
    const { row, uploadUrl, expiresAt } = await this.videos.create(auth, input, client);
    return { attachment: this.toDto(row), uploadUrl, expiresAt };
  }

  async create(auth: AuthContext, input: CreateUploadInput, client: ClientInfo): Promise<UploadTicket> {
    if (input.sizeBytes > this.deps.env.UPLOAD_MAX_BYTES) {
      const max = Math.floor(this.deps.env.UPLOAD_MAX_BYTES / (1024 * 1024));
      throw validationFailed([{ path: 'body.sizeBytes', message: `Arquivo grande demais (máximo ${max} MB)` }]);
    }

    const attachmentId = uuidv7();
    const key = `${auth.organizationId}/${input.workOrderId ?? input.vehicleId ?? 'geral'}/${attachmentId}.${EXTENSIONS[input.mimeType] ?? 'bin'}`;

    const row = await withTenant(this.deps.db, auth, async (tx) => {
      await assertCabeNoEspaco(tx, auth.organizationId, input.sizeBytes);
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
      attachment: this.toDto(row),
      uploadUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /** Confere o objeto no storage (tamanho e tipo) e libera o anexo. */
  async complete(auth: AuthContext, id: string): Promise<Attachment> {
    const row = await withTenant(this.deps.db, auth, async (tx) => {
      const attachment = await repo.findAttachment(tx, auth.organizationId, id);
      if (!attachment) throw notFound('Anexo não encontrado.');
      // vídeo (E45): conferido, vai para a fila de conversão; a segunda
      // chamada (clique duplo) só devolve o estado atual
      if (attachment.kind === 'VIDEO' && attachment.status !== 'PENDING_UPLOAD') return attachment;

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
      const teto = attachment.kind === 'VIDEO' ? this.deps.env.VIDEO_UPLOAD_MAX_BYTES : this.deps.env.UPLOAD_MAX_BYTES;
      if (info.sizeBytes > teto) {
        throw new AppError(409, ErrorCode.UPLOAD_INCOMPLETE, 'Arquivo grande demais', 'O arquivo passou do tamanho máximo.');
      }
      if (attachment.kind === 'VIDEO') return repo.markProcessing(tx, id, info.sizeBytes);
      return repo.markReady(tx, id, info.sizeBytes);
    });
    if (row.kind === 'VIDEO' && row.status === 'PROCESSING') this.processor.enfileirar(row.organizationId, row.id);
    return this.toDto(row);
  }

  async listForWorkOrder(auth: AuthContext, workOrderId: string): Promise<Attachment[]> {
    const rows = await withTenant(this.deps.db, auth, (tx) =>
      repo.listByWorkOrder(tx, auth.organizationId, workOrderId),
    );
    return rows.map((row) => this.toDto(row));
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    let apagarDepois: repo.AttachmentRow | null = null;
    await withTenant(this.deps.db, auth, async (tx) => {
      const attachment = await repo.findAttachment(tx, auth.organizationId, id);
      if (!attachment) throw notFound('Anexo não encontrado.');
      await repo.softDeleteAttachment(tx, id);
      // vídeo apagado libera o disco na hora; foto apagada continua guardada
      // (pode estar na prova de um orçamento já respondido)
      if (attachment.kind === 'VIDEO') {
        await repo.setStatus(tx, id, 'EXPIRED');
        apagarDepois = attachment;
      }
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
    // o arquivo sai depois do commit: se a transação desfizer, o vídeo continua lá
    if (apagarDepois) await this.videos.apagarArquivos(apagarDepois);
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

  head(key: string) {
    return this.deps.storage.head(key);
  }

  removeObject(key: string) {
    return this.deps.storage.remove(key);
  }

  stream(key: string, range?: ByteRange) {
    return this.deps.storage.stream(key, range);
  }

  write(key: string, body: Buffer, mimeType: string) {
    return this.deps.storage.put(key, body, mimeType);
  }

  /** Vídeo (E45): direto para o disco, com o teto do original. */
  writeStream(key: string, body: Readable, mimeType: string) {
    return this.deps.storage.putStream(key, body, mimeType, this.deps.env.VIDEO_UPLOAD_MAX_BYTES);
  }

  toDto(row: repo.AttachmentRow): Attachment {
    return anexoDto(this.deps.storage, row);
  }
}

/**
 * O anexo como a tela recebe. URL de leitura só para o que está pronto. O
 * vídeo leva também a capa e o link de baixar (o mesmo arquivo, com
 * `download=1`: a rota responde como anexo, e o celular salva em vez de abrir
 * o player). Fora da classe porque o check-in (E47) monta o mesmo anexo.
 */
export function anexoDto(storage: StorageProvider, row: repo.AttachmentRow): Attachment {
  const pronto = row.status === 'READY';
  const url = pronto ? storage.signDownload(row.storageKey).url : null;
  const video = row.kind === 'VIDEO';
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
    workOrderItemId: row.workOrderItemId,
    posterUrl: video && pronto && row.posterStorageKey ? storage.signDownload(row.posterStorageKey).url : null,
    downloadUrl: video && url ? linkDeBaixar(url, `video-oficina-${row.id.slice(-6)}.mp4`) : null,
    durationSeconds: row.durationSeconds,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    inspectionId: row.inspectionId,
  };
}

/** O link de baixar é o de ler com `download=1` e o nome do arquivo (fora da assinatura: não muda o que se lê). */
export function linkDeBaixar(url: string, nome: string): string {
  return `${url}&download=1&n=${encodeURIComponent(nome)}`;
}
