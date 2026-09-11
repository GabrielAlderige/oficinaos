import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityLogs } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

describe('clientes', () => {
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
  const patch = (id: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'PATCH', url: `/api/v1/customers/${id}`, headers: bearer(s.accessToken), payload });
  const post = (payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url: '/api/v1/customers', headers: bearer(s.accessToken), payload });

  it('cadastra só com o nome; o resto é opcional', async () => {
    const c = await createCustomer(t.app, owner, { name: 'Só o Nome' });
    expect(c).toMatchObject({ name: 'Só o Nome', type: 'PF', document: null, whatsapp: null, vehicleCount: 0 });
  });

  it('normaliza documento, WhatsApp, e-mail e CEP, e audita', async () => {
    const c = await createCustomer(t.app, owner, {
      name: 'João da Silva',
      document: '529.982.247-25',
      whatsapp: '(11) 98765-4321',
      email: 'Joao@Exemplo.com',
      address: { zip: '01310-100', street: 'Av. Paulista', number: '1000', complement: '', district: '', city: 'São Paulo', state: 'SP' },
      source: 'INDICACAO',
    });
    expect(c).toMatchObject({
      document: '52998224725',
      whatsapp: '+5511987654321',
      email: 'joao@exemplo.com',
      address: { zip: '01310100', city: 'São Paulo' },
      source: 'INDICACAO',
      contactMasked: false,
    });
    const logs = await withTenant(testDb().db, { organizationId: owner.orgId }, (tx) =>
      tx.select().from(activityLogs).where(and(eq(activityLogs.action, 'customer.created'), eq(activityLogs.entityId, c.id))),
    );
    expect(logs).toHaveLength(1);
  });

  it('pessoa física com CNPJ e empresa com CPF são recusados no campo certo', async () => {
    const pf = await post({ name: 'Fulano', type: 'PF', document: '11.222.333/0001-81' });
    expect(pf.statusCode).toBe(400);
    expect(pf.json().errors).toEqual([expect.objectContaining({ path: 'body.document' })]);
    const pj = await post({ name: 'Transportadora', type: 'PJ', document: '529.982.247-25' });
    expect(pj.statusCode).toBe(400);
    expect((await post({ name: 'Transportadora', type: 'PJ', document: '12.ABC.345/01DE-35' })).statusCode).toBe(201);
  });

  it('editar o tipo sem trocar o documento também é verificado', async () => {
    const c = await createCustomer(t.app, owner, { name: 'Maria', document: '111.444.777-35' });
    const res = await patch(c.id, { type: 'PJ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].path).toBe('body.document');
  });

  it('documento repetido → 409 no campo; depois de apagar o cliente, o documento volta a valer', async () => {
    const first = await createCustomer(t.app, owner, { name: 'Primeiro', document: '390.533.447-05' });
    const dup = await post({ name: 'Segundo', document: '39053344705' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ code: 'CUSTOMER_DOCUMENT_TAKEN', errors: [{ path: 'body.document' }] });

    const del = await t.app.inject({ method: 'DELETE', url: `/api/v1/customers/${first.id}`, headers: bearer(owner.accessToken) });
    expect(del.statusCode).toBe(204);
    expect((await post({ name: 'Segundo', document: '39053344705' })).statusCode).toBe(201);
  });

  it('PATCH só mexe no que foi enviado', async () => {
    const c = await createCustomer(t.app, owner, { name: 'Carla', whatsapp: '11987650000', notes: 'Prefere ligação' });
    const res = await patch(c.id, { name: 'Carla Souza' });
    expect(res.json()).toMatchObject({ name: 'Carla Souza', whatsapp: '+5511987650000', notes: 'Prefere ligação' });
  });

  describe('lista e busca', () => {
    let org: TestSession;

    beforeAll(async () => {
      org = await signup(t.app);
      const joao = await createCustomer(t.app, org, { name: 'João Pereira', whatsapp: '(21) 99888-7766' });
      await createCustomer(t.app, org, { name: 'Ana Lima', document: '529.982.247-25' });
      await createCustomer(t.app, org, { name: 'Bruno Costa' });
      await createVehicle(t.app, org, joao.id, { plate: 'ABC-1234' });
    });

    const names = async (q: string) =>
      (await get(`/api/v1/customers?q=${encodeURIComponent(q)}`, org)).json().data.map((c: { name: string }) => c.name);

    it('pagina no servidor, em ordem alfabética', async () => {
      const res = await get('/api/v1/customers?pageSize=2&page=1', org);
      expect(res.json().meta).toEqual({ page: 1, pageSize: 2, total: 3 });
      expect(res.json().data.map((c: { name: string }) => c.name)).toEqual(['Ana Lima', 'Bruno Costa']);
      expect((await get('/api/v1/customers?pageSize=2&page=2', org)).json().data).toHaveLength(1);
    });

    it('acha por nome sem acento, telefone, documento e placa do carro', async () => {
      expect(await names('joao')).toEqual(['João Pereira']);
      expect(await names('99888')).toEqual(['João Pereira']);
      expect(await names('529.982')).toEqual(['Ana Lima']);
      expect(await names('ABC1C34')).toEqual(['João Pereira']); // cadastrado como placa antiga
      expect(await names('100%')).toEqual([]); // % é literal, não curinga
    });

    it('a lista mostra as placas do cliente', async () => {
      const joao = (await get('/api/v1/customers?q=joao', org)).json().data[0];
      expect(joao).toMatchObject({ vehicleCount: 1, plates: ['ABC1234'] });
    });
  });

  describe('permissões e isolamento', () => {
    it('mecânico lê, com contato mascarado, mas não cadastra nem edita', async () => {
      const c = await createCustomer(t.app, owner, {
        name: 'Cliente Sigiloso',
        document: '935.411.347-80',
        whatsapp: '(11) 91234-5678',
        email: 'sigilo@exemplo.com',
        address: { zip: '01310100', street: 'Rua X', number: '1', complement: '', district: '', city: 'SP', state: 'SP' },
      });
      const mechanic = await addMember(t.app, owner, 'MECHANIC');

      const read = (await get(`/api/v1/customers/${c.id}`, mechanic)).json();
      expect(read).toMatchObject({
        name: 'Cliente Sigiloso',
        contactMasked: true,
        whatsapp: '(11) •••••-5678',
        document: '•••.•••.•••-80',
        email: 's•••@exemplo.com',
        address: { street: '', city: '' },
      });
      const list = (await get('/api/v1/customers?q=sigiloso', mechanic)).json().data[0];
      expect(list.whatsapp).toBe('(11) •••••-5678');

      expect((await post({ name: 'Novo' }, mechanic)).statusCode).toBe(403);
      // corpo inválido + sem permissão: 403, não 400 (autoriza antes de validar)
      expect((await patch(c.id, { name: 'X' }, mechanic)).statusCode).toBe(403);
    });

    it('atendente cadastra e edita, mas não apaga', async () => {
      const attendant = await addMember(t.app, owner, 'ATTENDANT');
      const c = await createCustomer(t.app, attendant, { name: 'Do Balcão' });
      expect((await patch(c.id, { notes: 'ok' }, attendant)).statusCode).toBe(200);
      const del = await t.app.inject({ method: 'DELETE', url: `/api/v1/customers/${c.id}`, headers: bearer(attendant.accessToken) });
      expect(del.statusCode).toBe(403);
    });

    it('outra oficina não lê, não edita, não apaga e não lista (404)', async () => {
      const c = await createCustomer(t.app, owner, { name: 'Cliente da Oficina A' });
      const other = await signup(t.app);
      expect((await get(`/api/v1/customers/${c.id}`, other)).statusCode).toBe(404);
      expect((await patch(c.id, { name: 'Tomado' }, other)).statusCode).toBe(404);
      const del = await t.app.inject({ method: 'DELETE', url: `/api/v1/customers/${c.id}`, headers: bearer(other.accessToken) });
      expect(del.statusCode).toBe(404);
      expect((await get('/api/v1/customers?q=Oficina A', other)).json().data).toEqual([]);
      expect((await get(`/api/v1/customers/${c.id}`)).json().name).toBe('Cliente da Oficina A');
    });
  });

  it('apagar o cliente tira os carros dele das listas', async () => {
    const c = await createCustomer(t.app, owner, { name: 'Vai Sair' });
    const v = await createVehicle(t.app, owner, c.id, { plate: 'DEL1A23' });
    await t.app.inject({ method: 'DELETE', url: `/api/v1/customers/${c.id}`, headers: bearer(owner.accessToken) });
    expect((await get(`/api/v1/customers/${c.id}`)).statusCode).toBe(404);
    expect((await get(`/api/v1/vehicles/${v.id}`)).statusCode).toBe(404);
    expect((await get('/api/v1/vehicles/lookup?plate=DEL1A23')).json().data).toEqual([]);
  });
});
