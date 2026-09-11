import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { buildApp, type App } from './app';
import { createDatabase } from './db/client';
import { testDb, testEnv } from '../test/helpers';

describe('API: fundação', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv(), db: testDb().db });
    // rota só de teste, para exercitar a validação e o formato de erro
    const probe: FastifyPluginAsyncZod = async (scope) => {
      scope.post(
        '/__probe',
        { schema: { body: z.object({ name: z.string().min(2), qty: z.number().positive() }) } },
        async (request) => ({ ok: request.body.name }),
      );
    };
    await app.register(probe, { prefix: '/api/v1' });
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /health responde ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /ready confirma o banco', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('GET /ready responde 503 quando o banco está fora', async () => {
    const offline = createDatabase('postgres://ninguem:x@127.0.0.1:1/nada', { max: 1 });
    const broken = await buildApp({ env: testEnv(), db: offline.db });
    try {
      const res = await broken.inject({ method: 'GET', url: '/api/v1/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: 'unavailable', database: 'unavailable' });
    } finally {
      await broken.close();
      await offline.pool.end();
    }
  });

  it('toda resposta leva x-request-id e os cabeçalhos de segurança', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('rota inexistente → 404 em problem+json', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nao-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('corpo inválido → 400 com o erro de cada campo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__probe',
      payload: { name: 'a', qty: -1 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.requestId).toBe(res.headers['x-request-id']);
    expect(body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['body.name', 'body.qty']);
  });

  it('JSON malformado → 400 problem+json, sem stack trace', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/__probe',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'BAD_REQUEST' });
    expect(res.body).not.toContain('at ');
  });

  it('CORS só libera a origem do painel', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'https://site-malicioso.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
