import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createTutorialLessonSchema,
  idParamSchema,
  setWatchedSchema,
  tutorialLessonSchema,
  tutorialOverviewSchema,
  updateTutorialLessonSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

/**
 * Tutoriais em vídeo (E39).
 *
 * Leitura: qualquer pessoa logada, **sem exigir permissão** — o mecânico
 * precisa aprender tanto quanto o dono, e trancar o manual atrás de um papel
 * seria o contrário do que a aba existe para fazer. É a mesma escolha da
 * ficha do carro (E36).
 * Escrita: `platform-admin`, que não é papel de oficina.
 */
export const tutorialsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.tutorials;

  app.get(
    '/',
    { config: { auth: 'authenticated' }, schema: { response: { 200: tutorialOverviewSchema } } },
    async (request) => service.overview(getAuth(request)),
  );

  app.put(
    '/:id/visto',
    {
      config: { auth: 'authenticated' },
      schema: { params: idParamSchema, body: setWatchedSchema, response: { 200: tutorialOverviewSchema } },
    },
    async (request) => service.setWatched(getAuth(request), request.params.id, request.body.watched),
  );

  // ------------------------- administração da plataforma -------------------

  app.get(
    '/admin',
    { config: { auth: 'platform-admin' }, schema: { response: { 200: tutorialOverviewSchema } } },
    async (request) => service.overview(getAuth(request), true),
  );

  app.post(
    '/admin',
    {
      config: { auth: 'platform-admin' },
      schema: { body: createTutorialLessonSchema, response: { 201: tutorialLessonSchema } },
    },
    async (request, reply) => {
      const aula = await service.create(getAuth(request), request.body, clientInfo(request));
      return reply.code(201).send(aula);
    },
  );

  app.patch(
    '/admin/:id',
    {
      config: { auth: 'platform-admin' },
      schema: { params: idParamSchema, body: updateTutorialLessonSchema, response: { 200: tutorialLessonSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.delete(
    '/admin/:id',
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
