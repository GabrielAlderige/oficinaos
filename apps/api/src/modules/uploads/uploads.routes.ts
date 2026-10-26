import { Readable } from 'node:stream';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  attachmentSchema,
  createUploadSchema,
  createVideoUploadSchema,
  idParamSchema,
  UPLOAD_MIME_TYPES,
  uploadTicketSchema,
  VIDEO_UPLOAD_MIME_TYPES,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';
import { type ByteRange, ObjectTooLargeError, type StorageAction } from '../../integrations/storage/storage';
import { VIDEO_PREFIX } from './videos.service';

const objectQuery = z.object({
  /** chave do objeto em base64url */
  k: z.string().min(1).max(512),
  a: z.enum(['put', 'get']),
  e: z.coerce.number().int(),
  s: z.string().min(1).max(256),
  /** `1` = responder como anexo (o botão "Baixar"); fica fora da assinatura */
  download: z.enum(['1']).optional(),
  /** nome sugerido para o arquivo baixado */
  n: z.string().max(120).optional(),
});

/**
 * Lê o cabeçalho Range. O Safari do iPhone NÃO toca vídeo de servidor que
 * ignora o Range: ele pede `bytes=0-1` primeiro e, sem o 206, desiste.
 * Só um intervalo por pedido (é o que os navegadores pedem para vídeo).
 *
 * `null` = sem Range válido (responde inteiro); `'invalido'` = fora do arquivo (416).
 */
export function lerRange(cabecalho: string | undefined, tamanho: number): ByteRange | null | 'invalido' {
  if (!cabecalho) return null;
  const partes = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!partes || (partes[1] === '' && partes[2] === '')) return null;
  let start: number;
  let end: number;
  if (partes[1] === '') {
    // `bytes=-500`: os últimos 500
    const sufixo = Number(partes[2]);
    if (sufixo === 0) return 'invalido';
    start = Math.max(0, tamanho - sufixo);
    end = tamanho - 1;
  } else {
    start = Number(partes[1]);
    end = partes[2] === '' ? tamanho - 1 : Math.min(Number(partes[2]), tamanho - 1);
  }
  if (start >= tamanho || start > end) return 'invalido';
  return { start, end };
}

/** Nome de arquivo seguro para o cabeçalho (sem aspas, barras nem quebra de linha). */
const nomeSeguro = (nome: string | undefined) => (nome ?? 'arquivo').replace(/[^\w.-]+/g, '-').slice(0, 120) || 'arquivo';

export const uploadRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.uploads;

  /**
   * O navegador envia a foto como binário puro. Sem um parser próprio o Fastify
   * responderia 415 (ele só entende JSON e texto), e o `bodyLimit` global de
   * 1 MiB cortaria o arquivo antes da nossa validação de tamanho.
   */
  app.addContentTypeParser(
    [...UPLOAD_MIME_TYPES],
    { parseAs: 'buffer', bodyLimit: app.env.UPLOAD_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  /**
   * Vídeo (E45): o corpo NÃO é lido aqui. O parser entrega o fluxo cru e a
   * rota grava direto no disco, contando os bytes — um original de 400 MB
   * nunca passa inteiro pela memória do servidor de 4 GB.
   */
  app.addContentTypeParser([...VIDEO_UPLOAD_MIME_TYPES], (_request, payload, done) => done(null, payload));

  app.post(
    '/videos',
    {
      config: { auth: 'work_orders:write', feature: 'work_order_video' },
      schema: { body: createVideoUploadSchema, response: { 201: uploadTicketSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.createVideo(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.post(
    '/',
    { config: { auth: 'work_orders:write' }, schema: { body: createUploadSchema, response: { 201: uploadTicketSchema } } },
    async (request, reply) => {
      reply.code(201);
      return service.create(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.post(
    '/:id/complete',
    { config: { auth: 'work_orders:write' }, schema: { params: idParamSchema, response: { 200: attachmentSchema } } },
    async (request) => service.complete(getAuth(request), request.params.id),
  );

  app.delete(
    '/:id',
    { config: { auth: 'work_orders:write' }, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.remove(getAuth(request), request.params.id, clientInfo(request));
      return reply.code(204).send();
    },
  );

  /**
   * Envio e leitura do arquivo. PÚBLICA de propósito: quem autoriza é a
   * assinatura da URL, com validade curta (ARCHITECTURE §11). Uma `<img src>`
   * não manda cabeçalho de autorização, e o navegador envia o arquivo direto.
   */
  app.route({
    method: ['GET', 'PUT'],
    url: '/object',
    config: { auth: 'public' },
    bodyLimit: app.env.UPLOAD_MAX_BYTES,
    schema: { querystring: objectQuery },
    handler: async (request, reply) => {
      const query = request.query as z.output<typeof objectQuery>;
      const action: StorageAction = request.method === 'PUT' ? 'put' : 'get';
      const key = Buffer.from(query.k, 'base64url').toString('utf8');

      if (query.a !== action || !service.verifySignature({ key, action, expires: query.e, signature: query.s })) {
        return reply.code(403).send({ message: 'Link expirado ou inválido.' });
      }

      if (action === 'put') {
        const body = request.body;
        const tipo = request.headers['content-type'] ?? 'application/octet-stream';
        if (body instanceof Readable) {
          // fluxo só para a pasta de vídeo: um link de FOTO não vira porta para 500 MB
          if (!key.startsWith(VIDEO_PREFIX)) return reply.code(415).send({ message: 'Tipo de arquivo não aceito aqui.' });
          try {
            const tamanho = await service.writeStream(key, body, tipo);
            if (!tamanho) {
              await service.removeObject(key);
              return reply.code(400).send({ message: 'Arquivo vazio.' });
            }
          } catch (erro) {
            if (erro instanceof ObjectTooLargeError) {
              return reply.code(413).send({ message: 'Vídeo grande demais.' });
            }
            throw erro;
          }
          return reply.code(204).send();
        }
        if (!Buffer.isBuffer(body) || !body.byteLength) return reply.code(400).send({ message: 'Arquivo vazio.' });
        await service.write(key, body, tipo);
        return reply.code(204).send();
      }

      const info = await service.head(key);
      if (!info) return reply.code(404).send({ message: 'Arquivo não encontrado.' });

      reply
        .header('content-type', info.mimeType)
        .header('cache-control', 'private, max-age=300')
        .header('accept-ranges', 'bytes');
      if (query.download) {
        reply.header('content-disposition', `attachment; filename="${nomeSeguro(query.n)}"`);
      }

      const range = lerRange(request.headers.range, info.sizeBytes);
      if (range === 'invalido') {
        return reply.code(416).header('content-range', `bytes */${info.sizeBytes}`).send();
      }
      const object = await service.stream(key, range ?? undefined);
      if (!object) return reply.code(404).send({ message: 'Arquivo não encontrado.' });
      if (range) {
        return reply
          .code(206)
          .header('content-range', `bytes ${range.start}-${range.end}/${info.sizeBytes}`)
          .header('content-length', range.end - range.start + 1)
          .send(object.body);
      }
      return reply.header('content-length', info.sizeBytes).send(object.body);
    },
  });
};

export const workOrderAttachmentRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.uploads;

  app.get(
    '/:id/attachments',
    {
      config: { auth: 'work_orders:read' },
      schema: { params: idParamSchema, response: { 200: z.object({ data: z.array(attachmentSchema) }) } },
    },
    async (request) => ({ data: await service.listForWorkOrder(getAuth(request), request.params.id) }),
  );
};
