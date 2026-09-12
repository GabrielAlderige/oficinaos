import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PART_CATEGORIES } from '@oficinaos/shared';
import { addMember, bearer, createTestApp, signup, type TestApp, type TestSession } from './helpers';

describe('catálogo de serviços e configurações de preço', () => {
  let t: TestApp;
  let owner: TestSession;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
  });
  afterAll(async () => {
    await t.app.close();
  });

  const get = (url: string, s: TestSession = owner) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const post = (payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url: '/api/v1/services', headers: bearer(s.accessToken), payload });
  const patch = (url: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload });

  it('oficina nova já nasce com as 11 categorias de peça, na ordem do briefing', async () => {
    const names = (await get('/api/v1/part-categories')).json().data.map((c: { name: string }) => c.name);
    expect(names).toEqual([...DEFAULT_PART_CATEGORIES]);
  });

  describe('configurações de preço', () => {
    it('começam com margem de 30%, estoque negativo permitido e sem hora técnica', async () => {
      const s = await signup(t.app);
      expect((await get('/api/v1/organization/settings', s)).json()).toEqual({
        laborRateCents: null,
        defaultMarkupBps: 3000,
        allowNegativeStock: true,
      });
    });

    it('só quem gerencia a oficina muda; atendente lê', async () => {
      const s = await signup(t.app);
      const attendant = await addMember(t.app, s, 'ATTENDANT');
      expect((await get('/api/v1/organization/settings', attendant)).statusCode).toBe(200);
      expect((await patch('/api/v1/organization/settings', { laborRateCents: 1 }, attendant)).statusCode).toBe(403);
      const ok = await patch('/api/v1/organization/settings', { laborRateCents: 18000 }, s);
      expect(ok.json()).toMatchObject({ laborRateCents: 18000, defaultMarkupBps: 3000 });
    });
  });

  describe('serviços', () => {
    it('preço fixo exige preço; por hora exige tempo padrão', async () => {
      const fixed = await post({ name: 'Troca de óleo' });
      expect(fixed.statusCode).toBe(400);
      expect(fixed.json().errors[0].path).toBe('body.priceCents');
      const hourly = await post({ name: 'Diagnóstico elétrico', pricingMode: 'HOURLY' });
      expect(hourly.json().errors[0].path).toBe('body.estimatedMinutes');
    });

    it('por hora: preço = hora técnica × tempo; sem hora técnica, fica sem preço', async () => {
      const s = await signup(t.app);
      const created = (await post({ name: 'Troca de embreagem', pricingMode: 'HOURLY', estimatedMinutes: 90 }, s)).json();
      expect(created.effectivePriceCents).toBeNull();

      await patch('/api/v1/organization/settings', { laborRateCents: 15000 }, s);
      expect((await get(`/api/v1/services/${created.id}`, s)).json().effectivePriceCents).toBe(22500);
    });

    it('fixo com intervalo de manutenção', async () => {
      const res = await post({ name: 'Troca de óleo e filtro', category: 'Revisão', priceCents: 12000, intervalKm: 10000, intervalMonths: 12 });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ effectivePriceCents: 12000, intervalKm: 10000, intervalMonths: 12, isActive: true });
    });

    it('nome repetido (sem diferenciar maiúsculas) → 409; depois de excluir, o nome volta a valer', async () => {
      const first = (await post({ name: 'Alinhamento', priceCents: 8000 })).json();
      const dup = await post({ name: 'ALINHAMENTO', priceCents: 9000 });
      expect(dup.statusCode).toBe(409);
      expect(dup.json()).toMatchObject({ code: 'SERVICE_NAME_TAKEN', errors: [{ path: 'body.name' }] });

      await t.app.inject({ method: 'DELETE', url: `/api/v1/services/${first.id}`, headers: bearer(owner.accessToken) });
      expect((await get(`/api/v1/services/${first.id}`)).statusCode).toBe(404);
      expect((await post({ name: 'alinhamento', priceCents: 9000 })).statusCode).toBe(201);
    });

    it('trocar para "por hora" sem tempo padrão é recusado; com tempo, o preço fixo some', async () => {
      const svc = (await post({ name: 'Balanceamento', priceCents: 6000 })).json();
      expect((await patch(`/api/v1/services/${svc.id}`, { pricingMode: 'HOURLY' })).statusCode).toBe(400);
      const ok = await patch(`/api/v1/services/${svc.id}`, { pricingMode: 'HOURLY', estimatedMinutes: 30 });
      expect(ok.json()).toMatchObject({ pricingMode: 'HOURLY', priceCents: null, estimatedMinutes: 30 });
    });

    it('busca sem acento, por nome ou categoria, e filtro de inativos', async () => {
      const s = await signup(t.app);
      await post({ name: 'Revisão dos 10 mil', priceCents: 30000 }, s);
      const old = (await post({ name: 'Carburação', category: 'Motor', priceCents: 20000 }, s)).json();
      await patch(`/api/v1/services/${old.id}`, { isActive: false }, s);

      const names = async (url: string) => (await get(url, s)).json().data.map((x: { name: string }) => x.name);
      expect(await names('/api/v1/services?q=revisao')).toEqual(['Revisão dos 10 mil']);
      expect(await names('/api/v1/services')).toEqual(['Revisão dos 10 mil']);
      expect(await names('/api/v1/services?status=inactive')).toEqual(['Carburação']);
      expect(await names('/api/v1/services?status=all&q=motor')).toEqual(['Carburação']);
    });

    it('mecânico consulta o catálogo, mas não cadastra', async () => {
      const mechanic = await addMember(t.app, owner, 'MECHANIC');
      expect((await get('/api/v1/services', mechanic)).statusCode).toBe(200);
      expect((await post({ name: 'Serviço do mecânico', priceCents: 1 }, mechanic)).statusCode).toBe(403);
    });

    it('outra oficina não vê o serviço (404)', async () => {
      const svc = (await post({ name: 'Exclusivo da oficina A', priceCents: 1000 })).json();
      const other = await signup(t.app);
      expect((await get(`/api/v1/services/${svc.id}`, other)).statusCode).toBe(404);
      expect((await get('/api/v1/services?q=exclusivo', other)).json().data).toEqual([]);
    });
  });
});
