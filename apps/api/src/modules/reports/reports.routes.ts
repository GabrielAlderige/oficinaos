import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  REPORT_KEYS,
  REPORT_PACK_KEYS,
  reportListSchema,
  reportPackListSchema,
  reportPackSchema,
  reportQuerySchema,
  reportSchema,
} from '@oficinaos/shared';
import { getAuth } from '../../core/auth-context';

/**
 * Relatórios (E15, ampliado na E44). Tudo aqui é `reports:read` — dono,
 * gerente e financeiro.
 *
 * O MESMO endpoint devolve JSON para a tela, CSV para a planilha e PDF para
 * ler e arquivar, escolhido por `?format=`: três caminhos para o mesmo número
 * seria pedir para eles divergirem.
 *
 * `/pacotes/:key` junta vários relatórios num documento só, com o mesmo
 * período, porque ninguém manda nove anexos para o contador.
 */
export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.reports;

  app.get(
    '/',
    { config: { auth: 'reports:read', feature: 'reports' }, schema: { response: { 200: reportListSchema } } },
    async () => service.list(),
  );

  app.get(
    '/pacotes',
    { config: { auth: 'reports:read', feature: 'reports' }, schema: { response: { 200: reportPackListSchema } } },
    async () => service.listPacks(),
  );

  app.get(
    '/pacotes/:key',
    {
      config: { auth: 'reports:read', feature: 'reports' },
      schema: {
        params: z.object({ key: z.enum(REPORT_PACK_KEYS) }),
        querystring: reportQuerySchema,
        // com format=csv|pdf a resposta é arquivo: o schema cobre só o JSON
        response: { 200: z.union([reportPackSchema, z.string(), z.instanceof(Buffer)]) },
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      if (request.query.format === 'csv') {
        const { fileName, content } = await service.packCsv(auth, request.params.key, request.query);
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${fileName}"`)
          .send(content);
      }
      if (request.query.format === 'pdf') {
        const { fileName, content } = await service.packPdf(auth, request.params.key, request.query);
        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `attachment; filename="${fileName}"`)
          .send(content);
      }
      return service.pack(auth, request.params.key, request.query);
    },
  );

  app.get(
    '/:key',
    {
      config: { auth: 'reports:read', feature: 'reports' },
      schema: {
        params: z.object({ key: z.enum(REPORT_KEYS) }),
        querystring: reportQuerySchema,
        response: { 200: z.union([reportSchema, z.string(), z.instanceof(Buffer)]) },
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      if (request.query.format === 'csv') {
        const { fileName, content } = await service.csv(auth, request.params.key, request.query);
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${fileName}"`)
          .send(content);
      }
      if (request.query.format === 'pdf') {
        const { fileName, content } = await service.pdf(auth, request.params.key, request.query);
        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `attachment; filename="${fileName}"`)
          .send(content);
      }
      return service.get(auth, request.params.key, request.query);
    },
  );
};
