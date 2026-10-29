import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checklistTemplateInputSchema, checklistTemplateSchema, idParamSchema } from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Checklists da oficina (E49). Quem faz o check-in lê; montar o modelo é
 * mexer no jeito de trabalhar da oficina, e fica com quem cuida do catálogo.
 */
export const checklistRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.checklists;
  const lista = z.object({ data: z.array(checklistTemplateSchema) });

  app.get(
    '/',
    { config: { auth: 'work_orders:read' }, schema: { response: { 200: lista } } },
    async (request) => ({ data: await service.list(getAuth(request)) }),
  );

  app.post(
    '/',
    { config: { auth: 'catalog:write' }, schema: { body: checklistTemplateInputSchema, response: { 201: checklistTemplateSchema } } },
    async (request, reply) => reply.code(201).send(await service.create(getAuth(request), request.body, clientInfo(request))),
  );

  app.put(
    '/:id',
    {
      config: { auth: 'catalog:write' },
      schema: { params: idParamSchema, body: checklistTemplateInputSchema, response: { 200: checklistTemplateSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.delete(
    '/:id',
    { config: { auth: 'catalog:write' }, schema: { params: idParamSchema, response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (request) => {
      await service.remove(getAuth(request), request.params.id, clientInfo(request));
      return { ok: true as const };
    },
  );

  app.post(
    '/order',
    {
      config: { auth: 'catalog:write' },
      schema: { body: z.object({ ids: z.array(z.uuid()).max(100) }), response: { 200: lista } },
    },
    async (request) => ({ data: await service.reorder(getAuth(request), request.body.ids) }),
  );
};
