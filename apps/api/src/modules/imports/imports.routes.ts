import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { IMPORT_KINDS, importRequestSchema, importResultSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Importação de planilha (E17). Cliente e veículo são cadastro de cliente
 * (`customers:write`); peça é catálogo (`catalog:write`). Uma rota só, com o
 * tipo no caminho — o corpo e o resultado são iguais nos três.
 */
export const importRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.imports;

  for (const kind of IMPORT_KINDS) {
    app.post(
      `/${kind}`,
      {
        config: { auth: kind === 'parts' ? 'catalog:write' : 'customers:write' },
        // planilha de migração é grande: o teto do corpo desta rota é maior
        bodyLimit: 8 * 1024 * 1024,
        schema: {
          body: importRequestSchema,
          response: { 200: importResultSchema },
        },
      },
      async (request) => service.run(getAuth(request), kind, request.body, clientInfo(request)),
    );
  }

  app.get(
    '/',
    {
      config: { auth: 'customers:read' },
      schema: {
        response: {
          200: z.object({
            data: z.array(
              z.object({
                kind: z.enum(IMPORT_KINDS),
                label: z.string(),
                required: z.array(z.string()),
                optional: z.array(z.string()),
              }),
            ),
          }),
        },
      },
    },
    async () => service.formats(),
  );
};
