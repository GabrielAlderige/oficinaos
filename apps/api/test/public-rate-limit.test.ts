import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createCustomer, createTestApp, createVehicle, createWorkOrder, signup, type TestApp, type TestSession } from './helpers';

/**
 * O link do orçamento é público e vai por WhatsApp: pode ser encaminhado,
 * indexado por engano ou varrido. O limite por IP (docs/API.md §1.2) é o que
 * impede alguém de martelar a página — 60/min para abrir, 10/min para agir.
 *
 * Este teste existe porque `config.rateLimit` por rota é o tipo de configuração
 * que FALHA EM SILÊNCIO: se o override não valer, tudo continua respondendo
 * 200 e ninguém percebe até o dia do abuso.
 */
describe('limite por IP nas rotas públicas', () => {
  let t: TestApp;
  let owner: TestSession;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    const service = await t.app.inject({
      method: 'POST',
      url: '/api/v1/services',
      headers: bearer(owner.accessToken),
      payload: { name: 'Revisão', priceCents: 20000 },
    });
    const customer = await createCustomer(t.app, owner, { name: 'Cliente do Limite' });
    const vehicle = await createVehicle(t.app, owner, customer.id, { plate: 'RLM1A23' });
    const order = await createWorkOrder(t.app, owner, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      items: [{ type: 'SERVICE', serviceId: service.json().id }],
    });
    const quote = await t.app.inject({
      method: 'POST',
      url: `/api/v1/work-orders/${order.id}/quotes`,
      headers: bearer(owner.accessToken),
      payload: {},
    });
    token = (quote.json().publicUrl as string).split('/').pop() as string;
  });
  afterAll(async () => {
    await t.app.close();
  });

  /** Mesmo IP em todas as chamadas: é assim que o limite é contado. */
  const abrir = (ip: string) =>
    t.app.inject({ method: 'GET', url: `/api/v1/public/quotes/${token}`, remoteAddress: ip });

  it('abrir o link tem teto de 60 por minuto no mesmo IP', async () => {
    const ip = '203.0.113.10';
    const respostas: number[] = [];
    for (let i = 0; i < 62; i += 1) respostas.push((await abrir(ip)).statusCode);

    expect(respostas.filter((status) => status === 200).length).toBe(60);
    expect(respostas.at(-1)).toBe(429);
  });

  it('o limite é POR IP: outro aparelho continua abrindo normalmente', async () => {
    expect((await abrir('203.0.113.99')).statusCode).toBe(200);
  });

  it('agir tem teto mais apertado que abrir (10 por minuto)', async () => {
    const ip = '203.0.113.20';
    const respostas: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/v1/public/quotes/${token}/questions`,
        remoteAddress: ip,
        payload: { message: 'Tem desconto à vista?' },
      });
      respostas.push(res.statusCode);
    }

    expect(respostas.filter((status) => status === 204).length).toBe(10);
    expect(respostas.at(-1)).toBe(429);
  });

  it('o 429 sai no formato de erro da API, com Retry-After', async () => {
    const ip = '203.0.113.30';
    let ultima = await abrir(ip);
    for (let i = 0; i < 61 && ultima.statusCode !== 429; i += 1) ultima = await abrir(ip);

    expect(ultima.statusCode).toBe(429);
    expect(ultima.json().code).toBe('RATE_LIMITED');
    expect(ultima.headers['retry-after']).toBeDefined();
  });
});
