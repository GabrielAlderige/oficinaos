import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createProspectSchema,
  idParamSchema,
  prospectCreatedSchema,
  prospectSchema,
  prospectsOverviewSchema,
  updateProspectSchema,
} from '@oficinaos/shared';
import { clientInfo } from '../../core/auth-context';

/**
 * Interessados vindos da landing (E42).
 *
 * `POST /` é **público**: é o formulário do site, que é servido no domínio
 * raiz e não tem login nenhum. O limite por IP é o mesmo do cadastro de
 * oficina — 10 por hora, 200 em desenvolvimento — porque o padrão de uso é
 * igual: uma pessoa preenche uma vez, e quem preenche cinquenta vezes é robô.
 *
 * O resto é `platform-admin`: a lista e a planilha do remarketing são do
 * comercial, não de oficina nenhuma.
 */
export const prospectsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.prospects;
  const emDesenvolvimento = app.env.NODE_ENV === 'development';

  app.post(
    '/',
    {
      config: {
        auth: 'public',
        rateLimit: { max: emDesenvolvimento ? 200 : 10, timeWindow: '1 hour' },
      },
      schema: { body: createProspectSchema, response: { 201: prospectCreatedSchema } },
    },
    async (request, reply) => {
      await service.create(request.body, clientInfo(request));
      return reply.code(201).send({ ok: true as const });
    },
  );

  // ----------------------------- plataforma ------------------------------

  app.get(
    '/',
    { config: { auth: 'platform-admin' }, schema: { response: { 200: prospectsOverviewSchema } } },
    async () => service.overview(),
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'platform-admin' },
      schema: { params: idParamSchema, body: updateProspectSchema, response: { 200: prospectSchema } },
    },
    async (request) => service.update(request.params.id, request.body),
  );

  /** A planilha do remarketing. Sai como arquivo, não como JSON. */
  app.get(
    '/csv',
    { config: { auth: 'platform-admin' }, schema: { response: { 200: z.string() } } },
    async (_request, reply) => {
      const conteudo = await service.csv();
      const hoje = new Date().toISOString().slice(0, 10);
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="interessados-${hoje}.csv"`)
        .send(conteudo);
    },
  );
};
