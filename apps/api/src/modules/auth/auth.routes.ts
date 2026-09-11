import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  acceptInvitationSchema,
  authResponseSchema,
  ErrorCode,
  forgotPasswordSchema,
  idParamSchema,
  invitationPreviewSchema,
  invitationTokenParamsSchema,
  loginSchema,
  meSchema,
  resetPasswordSchema,
  sessionSchema,
  signupSchema,
  switchOrganizationSchema,
} from '@oficinaos/shared';
import type { Env } from '../../config/env';
import { clientInfo, getAuth } from '../../core/auth-context';
import { AppError } from '../../core/errors';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, REFRESH_TOKEN_TTL_MS } from './auth.constants';
import type { AuthResult } from './auth.service';

/**
 * Rotas que leem ou gravam o cookie de sessão exigem Origin conhecido: com
 * SameSite=Strict isso fecha CSRF mesmo em navegador antigo.
 */
function assertAllowedOrigin(request: FastifyRequest, env: Env) {
  const origin = request.headers.origin;
  if (!origin || !env.WEB_ORIGINS.includes(origin)) {
    throw new AppError(403, ErrorCode.ORIGIN_NOT_ALLOWED, 'Origem não autorizada', 'Acesse pelo painel do OficinaOS.');
  }
}

function sendAuth(reply: FastifyReply, result: AuthResult, env: Env) {
  if (result.refreshToken) {
    reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_MS / 1000,
    });
  }
  const { refreshToken: _omit, ...body } = result;
  return body;
}

const emailKey = (request: FastifyRequest) =>
  String((request.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase();

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.services.auth;
  const env = app.env;

  app.post(
    '/signup',
    {
      config: { auth: 'public', rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { body: signupSchema, response: { 201: authResponseSchema } },
    },
    async (request, reply) => {
      assertAllowedOrigin(request, env);
      const result = await service.signup(request.body, clientInfo(request));
      reply.code(201);
      return sendAuth(reply, result, env);
    },
  );

  app.post(
    '/login',
    {
      config: {
        auth: 'public',
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (request) => `login:${request.ip}:${emailKey(request)}`,
        },
      },
      schema: { body: loginSchema, response: { 200: authResponseSchema } },
    },
    async (request, reply) => {
      assertAllowedOrigin(request, env);
      return sendAuth(reply, await service.login(request.body, clientInfo(request)), env);
    },
  );

  app.post(
    '/refresh',
    {
      config: { auth: 'public', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { response: { 200: authResponseSchema, 204: z.null() } },
    },
    async (request, reply) => {
      assertAllowedOrigin(request, env);
      const token = request.cookies[REFRESH_COOKIE];
      // sem cookie não há o que renovar: é visitante, não erro (evita um 401 a cada visita ao login)
      if (!token) return reply.code(204).send(null);
      return sendAuth(reply, await service.refresh(token, clientInfo(request)), env);
    },
  );

  app.post('/logout', { config: { auth: 'public' } }, async (request, reply) => {
    assertAllowedOrigin(request, env);
    const bearer = request.headers.authorization?.replace(/^Bearer /, '');
    const claims = bearer ? await app.tokens.verify(bearer) : null;
    await service.logout(request.cookies[REFRESH_COOKIE], claims?.sessionId);
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return reply.code(204).send();
  });

  app.post(
    '/forgot-password',
    {
      config: {
        auth: 'public',
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          hook: 'preHandler',
          keyGenerator: (request) => `forgot:${emailKey(request)}`,
        },
      },
      schema: { body: forgotPasswordSchema, response: { 202: z.object({ message: z.string() }) } },
    },
    async (request, reply) => {
      await service.forgotPassword(request.body.email, clientInfo(request));
      reply.code(202);
      return { message: 'Se existir uma conta com este e-mail, enviamos um link para redefinir a senha.' };
    },
  );

  app.post(
    '/reset-password',
    {
      config: { auth: 'public', rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { body: resetPasswordSchema },
    },
    async (request, reply) => {
      await service.resetPassword(request.body.token, request.body.password);
      return reply.code(204).send();
    },
  );

  app.get(
    '/me',
    { config: { auth: 'authenticated' }, schema: { response: { 200: meSchema } } },
    async (request) => service.me(getAuth(request)),
  );

  app.get(
    '/sessions',
    {
      config: { auth: 'authenticated' },
      schema: { response: { 200: z.object({ data: z.array(sessionSchema) }) } },
    },
    async (request) => ({ data: await service.listSessions(getAuth(request)) }),
  );

  app.delete(
    '/sessions/:id',
    { config: { auth: 'authenticated' }, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.revokeSession(getAuth(request), request.params.id);
      return reply.code(204).send();
    },
  );

  app.post(
    '/switch-organization',
    {
      config: { auth: 'authenticated' },
      schema: { body: switchOrganizationSchema, response: { 200: authResponseSchema } },
    },
    async (request, reply) => {
      const result = await service.switchOrganization(getAuth(request), request.body.organizationId);
      return sendAuth(reply, result, env);
    },
  );

  app.get(
    '/invitations/:token',
    {
      config: { auth: 'public', rateLimit: { max: 30, timeWindow: '15 minutes' } },
      schema: { params: invitationTokenParamsSchema, response: { 200: invitationPreviewSchema } },
    },
    async (request) => service.invitationPreview(request.params.token),
  );

  app.post(
    '/accept-invite',
    {
      config: { auth: 'public', rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: { body: acceptInvitationSchema, response: { 200: authResponseSchema } },
    },
    async (request, reply) => {
      assertAllowedOrigin(request, env);
      return sendAuth(reply, await service.acceptInvitation(request.body, clientInfo(request)), env);
    },
  );
};
