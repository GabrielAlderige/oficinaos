import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  attachmentSchema,
  createUploadSchema,
  idParamSchema,
  UPLOAD_MIME_TYPES,
  uploadTicketSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';
import type { StorageAction } from '../../integrations/storage/storage';

const objectQuery = z.object({
  /** chave do objeto em base64url */
  k: z.string().min(1).max(512),
  a: z.enum(['put', 'get']),
  e: z.coerce.number().int(),
  s: z.string().min(1).max(256),
});

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
        if (!Buffer.isBuffer(body) || !body.byteLength) return reply.code(400).send({ message: 'Arquivo vazio.' });
        await service.write(key, body, request.headers['content-type'] ?? 'application/octet-stream');
        return reply.code(204).send();
      }

      const object = await service.read(key);
      if (!object) return reply.code(404).send({ message: 'Arquivo não encontrado.' });
      return reply
        .header('content-type', object.info.mimeType)
        .header('cache-control', 'private, max-age=300')
        .send(object.body);
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
