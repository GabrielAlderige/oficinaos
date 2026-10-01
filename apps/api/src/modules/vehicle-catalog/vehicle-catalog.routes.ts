import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  catalogCoverageSchema,
  catalogSearchQuerySchema,
  catalogVehicleRequestSchema,
  catalogVehicleSchema,
  catalogVehicleSummarySchema,
  createCatalogVehicleSchema,
  idParamSchema,
  paginated,
  requestCatalogVehicleSchema,
  updateCatalogVehicleSchema,
  chassiLidoSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Ficha do carro (E31).
 *
 * Leitura: qualquer pessoa logada numa oficina — é informação de bancada, e
 * esconder do mecânico seria esvaziar o motivo de existir.
 * Escrita: `platform-admin`, que NÃO é papel de oficina. Nem o dono da
 * oficina edita o catálogo que todas as outras leem.
 */
export const vehicleCatalogRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.vehicleCatalog;

  app.get(
    '/coverage',
    { config: { auth: 'authenticated' }, schema: { response: { 200: catalogCoverageSchema } } },
    async () => service.coverage(),
  );

  app.get(
    '/',
    {
      config: { auth: 'authenticated' },
      schema: {
        querystring: catalogSearchQuerySchema,
        // a leitura do chassi (E43) sai junto com a página: a tela precisa
        // dizer por que a lista encolheu
        response: { 200: paginated(catalogVehicleSummarySchema).extend({ chassi: chassiLidoSchema.optional() }) },
      },
    },
    async (request) => service.search(getAuth(request), request.query),
  );

  app.get(
    '/:id',
    { config: { auth: 'authenticated' }, schema: { params: idParamSchema, response: { 200: catalogVehicleSchema } } },
    async (request) => service.get(getAuth(request), request.params.id),
  );

  /** "Não achei o meu carro": vira a fila de prioridade de quem preenche. */
  app.post(
    '/requests',
    {
      config: { auth: 'authenticated' },
      schema: { body: requestCatalogVehicleSchema, response: { 202: z.object({ message: z.string() }) } },
    },
    async (request, reply) => {
      await service.request(getAuth(request), request.body, clientInfo(request));
      reply.code(202);
      return { message: 'Anotado. Os carros mais pedidos são os próximos a entrar.' };
    },
  );

  // ------------------------- só a plataforma -------------------------

  app.get(
    '/requests/queue',
    {
      config: { auth: 'platform-admin' },
      schema: { response: { 200: z.object({ data: z.array(catalogVehicleRequestSchema) }) } },
    },
    async () => ({ data: await service.requests() }),
  );

  app.post(
    '/',
    {
      config: { auth: 'platform-admin' },
      schema: { body: createCatalogVehicleSchema, response: { 201: catalogVehicleSchema } },
    },
    async (request, reply) => {
      const ficha = await service.create(getAuth(request), request.body, clientInfo(request));
      return reply.code(201).send(ficha);
    },
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'platform-admin' },
      schema: { params: idParamSchema, body: updateCatalogVehicleSchema, response: { 200: catalogVehicleSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.delete(
    '/:id',
    {
      config: { auth: 'platform-admin' },
      schema: { params: idParamSchema, response: { 200: z.object({ ok: z.literal(true) }) } },
    },
    async (request) => {
      await service.remove(getAuth(request), request.params.id, clientInfo(request));
      return { ok: true as const };
    },
  );
};
