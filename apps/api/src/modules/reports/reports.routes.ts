import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { REPORT_KEYS, reportListSchema, reportQuerySchema, reportSchema } from '@oficinaos/shared';
import { getAuth } from '../../core/auth-context';

/**
 * Relatórios (E15). Tudo aqui é `reports:read` — dono, gerente e financeiro.
 * O mesmo endpoint devolve JSON para a tela e CSV para a planilha, escolhido
 * por `?format=csv`: dois caminhos para o mesmo número seria pedir para eles
 * divergirem.
 */
export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.reports;

  app.get(
    '/',
    { config: { auth: 'reports:read' }, schema: { response: { 200: reportListSchema } } },
    async () => service.list(),
  );

  app.get(
    '/:key',
    {
      config: { auth: 'reports:read' },
      schema: {
        params: z.object({ key: z.enum(REPORT_KEYS) }),
        querystring: reportQuerySchema,
        // com format=csv a resposta é texto: o schema cobre só o JSON
        response: { 200: z.union([reportSchema, z.string()]) },
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
      return service.get(auth, request.params.key, request.query);
    },
  );
};
