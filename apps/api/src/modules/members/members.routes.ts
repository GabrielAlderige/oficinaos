import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createdInvitationSchema,
  createInvitationSchema,
  idParamSchema,
  invitationSchema,
  memberSchema,
  updateMemberSchema,
} from '@oficinaos/shared';
import { clientInfo, getAuth } from '../../core/auth-context';

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.members;

  // qualquer membro vê a equipe (a agenda e a OS precisam escolher o mecânico)
  app.get(
    '/',
    { config: { auth: 'authenticated' }, schema: { response: { 200: z.object({ data: z.array(memberSchema) }) } } },
    async (request) => ({ data: await service.list(getAuth(request)) }),
  );

  app.get(
    '/invitations',
    {
      config: { auth: 'team:manage' },
      schema: { response: { 200: z.object({ data: z.array(invitationSchema) }) } },
    },
    async (request) => ({ data: await service.listInvitations(getAuth(request)) }),
  );

  app.post(
    '/invitations',
    {
      config: { auth: 'team:manage' },
      schema: { body: createInvitationSchema, response: { 201: createdInvitationSchema } },
    },
    async (request, reply) => {
      reply.code(201);
      return service.invite(getAuth(request), request.body, clientInfo(request));
    },
  );

  app.delete(
    '/invitations/:id',
    { config: { auth: 'team:manage' }, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.revokeInvitation(getAuth(request), request.params.id, clientInfo(request));
      return reply.code(204).send();
    },
  );

  app.patch(
    '/:id',
    {
      config: { auth: 'team:manage' },
      schema: { params: idParamSchema, body: updateMemberSchema, response: { 200: memberSchema } },
    },
    async (request) => service.update(getAuth(request), request.params.id, request.body, clientInfo(request)),
  );

  app.delete(
    '/:id',
    { config: { auth: 'team:manage' }, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.remove(getAuth(request), request.params.id, clientInfo(request));
      return reply.code(204).send();
    },
  );
};
