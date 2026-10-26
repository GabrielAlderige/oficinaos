import { v7 as uuidv7 } from 'uuid';
import { type CreateVideoUploadInput, type UploadTicket, VIDEO_RETENTION_DAYS } from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound, validationFailed } from '../../core/errors';
import { blankToNull } from '../../core/normalize';
import { type Tx, withJobRunner, withTenant } from '../../db/tenant';
import type { VideoTranscoder } from '../../integrations/video/transcoder';
import { activeOrganizations } from '../automations/automations.repository';
import { assertCabeNoEspaco } from './storage-quota';
import * as repo from './uploads.repository';

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * As chaves de vídeo moram numa pasta própria (`videos/`): o backup diário
 * deixa ela de fora — vídeo vive 7 dias, não faz sentido guardar 30 dias de
 * cópia dele no Drive — e a rota do arquivo só aceita envio em fluxo aqui.
 */
export const VIDEO_PREFIX = 'videos/';

const chaves = (organizationId: string, workOrderId: string, id: string) => {
  const base = `${VIDEO_PREFIX}${organizationId}/${workOrderId}/${id}`;
  return { original: `${base}.original`, video: `${base}.mp4`, poster: `${base}.jpg` };
};

/**
 * O prazo do vídeo começa quando o cliente responde (aprova, aprova em parte
 * ou recusa). Chamado DENTRO da transação da decisão do orçamento: ou as
 * duas coisas acontecem, ou nenhuma.
 */
export function marcarPrazoDosVideos(tx: Tx, organizationId: string, quoteId: string, respondidoEm: Date) {
  const expiresAt = new Date(respondidoEm.getTime() + VIDEO_RETENTION_DAYS * DIA_MS);
  return repo.setVideoDeadlineForQuote(tx, organizationId, quoteId, expiresAt);
}

/**
 * Vídeo na OS (E45): o mecânico grava, o vídeo vai no orçamento, e 7 dias
 * depois da resposta do cliente o arquivo sai do disco.
 *
 * O caminho é o mesmo da foto (ticket → envio direto → conferência), com uma
 * etapa a mais: a conversão no servidor. Ver `FfmpegTranscoder` para o porquê.
 */
export class VideosService {
  constructor(private readonly deps: ServiceDeps) {}

  async create(
    auth: AuthContext,
    input: CreateVideoUploadInput,
    client: ClientInfo,
  ): Promise<{ row: repo.AttachmentRow } & Omit<UploadTicket, 'attachment'>> {
    if (input.sizeBytes > this.deps.env.VIDEO_UPLOAD_MAX_BYTES) {
      const max = Math.floor(this.deps.env.VIDEO_UPLOAD_MAX_BYTES / (1024 * 1024));
      throw validationFailed([{ path: 'body.sizeBytes', message: `Vídeo grande demais (máximo ${max} MB)` }]);
    }

    const id = uuidv7();
    const { original } = chaves(auth.organizationId, input.workOrderId, id);

    const row = await withTenant(this.deps.db, auth, async (tx) => {
      if (!(await repo.workOrderExists(tx, auth.organizationId, input.workOrderId))) throw notFound('OS não encontrada.');
      if (
        input.workOrderItemId &&
        !(await repo.itemBelongsToWorkOrder(tx, auth.organizationId, input.workOrderId, input.workOrderItemId))
      ) {
        throw validationFailed([{ path: 'body.workOrderItemId', message: 'Este item não é desta OS' }]);
      }
      await assertCabeNoEspaco(tx, auth.organizationId, input.sizeBytes);
      const created = await repo.insertAttachment(tx, {
        id,
        organizationId: auth.organizationId,
        workOrderId: input.workOrderId,
        workOrderItemId: input.workOrderItemId,
        kind: 'VIDEO',
        storageKey: original,
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
        metadata: { kind: 'VIDEO', workOrderId: created.workOrderId },
        ...client,
      });
      return created;
    });

    const signed = this.deps.storage.signUpload(original);
    return { row, uploadUrl: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  /** Apaga do disco o vídeo e a capa (o original também, se ainda existir). */
  async apagarArquivos(row: repo.AttachmentRow): Promise<void> {
    const { original, video, poster } = chaves(row.organizationId, row.workOrderId ?? '', row.id);
    const todas = new Set([row.storageKey, row.posterStorageKey, original, video, poster].filter(Boolean) as string[]);
    for (const chave of todas) await this.deps.storage.remove(chave);
  }

  /**
   * A limpeza de hora em hora (chamada pela volta das automações). Primeiro o
   * arquivo sai do disco, depois a linha vira EXPIRED: se o processo cair no
   * meio, a próxima volta tenta de novo — apagar o que já não existe não dá erro.
   */
  async apagarVencidos(organizationId: string, agora = new Date()): Promise<number> {
    const vencidos = await withTenant(this.deps.db, { organizationId }, (tx) =>
      repo.listVideosToPurge(tx, organizationId, agora),
    );
    for (const row of vencidos) {
      await this.apagarArquivos(row);
      await withTenant(this.deps.db, { organizationId }, (tx) => repo.setStatus(tx, row.id, 'EXPIRED'));
    }
    return vencidos.length;
  }
}

/**
 * A fila da conversão: um vídeo por vez, dentro do próprio processo da API.
 *
 * Por que não no pg-boss: a conversão precisa do arquivo que está no disco
 * DESTE servidor, e só existe uma API. Se ela reiniciar no meio, `retomar()`
 * (chamado na subida) devolve à fila tudo o que ficou em PROCESSING.
 */
export class VideoProcessor {
  private fila: { organizationId: string; id: string }[] = [];
  private rodando: Promise<void> | null = null;

  constructor(
    private readonly deps: ServiceDeps,
    private readonly transcoder: VideoTranscoder,
    private readonly videos: VideosService,
  ) {}

  enfileirar(organizationId: string, id: string): void {
    if (this.fila.some((item) => item.id === id)) return;
    this.fila.push({ organizationId, id });
    this.rodando ??= this.esvaziar().finally(() => {
      this.rodando = null;
    });
  }

  /** Espera a fila acabar. Os testes usam; a API não precisa. */
  async ocioso(): Promise<void> {
    while (this.rodando) await this.rodando;
  }

  async retomar(): Promise<number> {
    const oficinas = await withJobRunner(this.deps.db, (tx) => activeOrganizations(tx));
    let total = 0;
    for (const oficina of oficinas) {
      const pendentes = await withTenant(this.deps.db, { organizationId: oficina.id }, (tx) =>
        repo.listProcessingVideos(tx, oficina.id),
      );
      for (const pendente of pendentes) this.enfileirar(oficina.id, pendente.id);
      total += pendentes.length;
    }
    return total;
  }

  private async esvaziar(): Promise<void> {
    for (let item = this.fila.shift(); item; item = this.fila.shift()) {
      try {
        await this.converter(item.organizationId, item.id);
      } catch (erro) {
        this.deps.log.error({ err: erro, attachmentId: item.id }, 'vídeo: falha inesperada na fila');
      }
    }
  }

  private async converter(organizationId: string, id: string): Promise<void> {
    const ctx = { organizationId };
    const row = await withTenant(this.deps.db, ctx, (tx) => repo.findAttachment(tx, organizationId, id));
    if (!row || row.status !== 'PROCESSING') return;

    const { video, poster } = chaves(organizationId, row.workOrderId ?? '', id);
    const inicio = Date.now();
    try {
      const resultado = await this.transcoder.transcode({
        storage: this.deps.storage,
        sourceKey: row.storageKey,
        videoKey: video,
        posterKey: poster,
      });
      const pronto = await withTenant(this.deps.db, ctx, (tx) =>
        repo.markVideoReady(tx, id, {
          storageKey: video,
          posterStorageKey: poster,
          sizeBytes: resultado.sizeBytes,
          durationSeconds: resultado.durationSeconds,
        }),
      );
      // o original (até 500 MB) só servia para virar o MP4
      await this.deps.storage.remove(row.storageKey);
      const atual = await withTenant(this.deps.db, ctx, (tx) => repo.findAttachment(tx, organizationId, id));
      if (!pronto || !atual) {
        // apagado enquanto convertia: o que acabou de ser gravado sai também
        await this.videos.apagarArquivos({ ...row, storageKey: video, posterStorageKey: poster });
        return;
      }
      this.deps.log.info(
        { attachmentId: id, segundos: resultado.durationSeconds, bytes: resultado.sizeBytes, ms: Date.now() - inicio },
        'vídeo convertido',
      );
    } catch (erro) {
      this.deps.log.error({ err: erro, attachmentId: id }, 'vídeo: a conversão falhou');
      await withTenant(this.deps.db, ctx, (tx) => repo.setStatus(tx, id, 'FAILED'));
      await this.videos.apagarArquivos(row);
    }
  }
}
