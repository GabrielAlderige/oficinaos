import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

describe('veículos', () => {
  let t: TestApp;
  let owner: TestSession;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    customerId = (await createCustomer(t.app, owner, { name: 'Dona do Carro', whatsapp: '11987654321' })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const get = (url: string, s: TestSession = owner) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const post = (url: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });
  const patch = (id: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'PATCH', url: `/api/v1/vehicles/${id}`, headers: bearer(s.accessToken), payload });

  describe('placa antiga ↔ Mercosul', () => {
    it('cadastrada como antiga, acha pela Mercosul, pelo começo e pela antiga', async () => {
      const v = await createVehicle(t.app, owner, customerId, { plate: 'kbc-1234', make: 'Fiat', model: 'Uno' });
      expect(v.plate).toBe('KBC1234');

      const lookup = async (plate: string) =>
        (await get(`/api/v1/vehicles/lookup?plate=${plate}`)).json().data.map((x: { id: string }) => x.id);
      expect(await lookup('KBC1C34')).toEqual([v.id]);
      expect(await lookup('kbc1234')).toEqual([v.id]);
      expect(await lookup('KBC-12')).toEqual([v.id]);
      expect(await lookup('KBC1D')).toEqual([]);
    });

    it('a mesma placa nos dois formatos é o MESMO carro: segundo cadastro → 409 com o nome do dono', async () => {
      await createVehicle(t.app, owner, customerId, { plate: 'MNO1234' });
      const dup = await post('/api/v1/vehicles', { customerId, make: 'Ford', model: 'Ka', plate: 'MNO1C34' });
      expect(dup.statusCode).toBe(409);
      expect(dup.json()).toMatchObject({ code: 'PLATE_ALREADY_REGISTERED', errors: [{ path: 'body.plate' }] });
      expect(dup.json().detail).toContain('Dona do Carro');
    });

    it('placa de veículo apagado pode ser usada de novo', async () => {
      const v = await createVehicle(t.app, owner, customerId, { plate: 'PQR5E67' });
      await t.app.inject({ method: 'DELETE', url: `/api/v1/vehicles/${v.id}`, headers: bearer(owner.accessToken) });
      expect((await post('/api/v1/vehicles', { customerId, make: 'Fiat', model: 'Mobi', plate: 'PQR5E67' })).statusCode).toBe(201);
    });

    it('trocar a placa para uma já usada também é barrado', async () => {
      await createVehicle(t.app, owner, customerId, { plate: 'STU1A11' });
      const other = await createVehicle(t.app, owner, customerId, { plate: 'STU1A22' });
      expect((await patch(other.id, { plate: 'STU-1011' })).statusCode).toBe(409); // STU1011 = STU1A11
    });
  });

  it('valida placa, anos e chassi no campo certo', async () => {
    const res = await post('/api/v1/vehicles', {
      customerId,
      make: 'VW',
      model: 'Gol',
      plate: 'AB12345',
      yearManufacture: 2020,
      yearModel: 2023,
      vin: 'CURTO',
    });
    expect(res.statusCode).toBe(400);
    const paths = res.json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['body.plate', 'body.yearModel', 'body.vin']));
  });

  describe('quilometragem', () => {
    it('registra leituras; diminuir exige confirmação explícita', async () => {
      const v = await createVehicle(t.app, owner, customerId, { plate: 'KMS1A00', odometerKm: 50000 });
      expect((await patch(v.id, { odometerKm: 58000 })).json().odometerKm).toBe(58000);

      const lower = await patch(v.id, { odometerKm: 5800 });
      expect(lower.statusCode).toBe(422);
      expect(lower.json()).toMatchObject({ code: 'ODOMETER_DECREASE', errors: [{ path: 'body.odometerKm' }] });
      expect(lower.json().detail).toContain('58.000 km');

      const confirmed = await patch(v.id, { odometerKm: 5800, confirmOdometerDecrease: true });
      expect(confirmed.json().odometerKm).toBe(5800);

      const readings = (await get(`/api/v1/vehicles/${v.id}/odometer-readings`)).json().data;
      expect(readings.map((r: { km: number }) => r.km)).toEqual([5800, 58000, 50000]);
      expect(readings[0]).toMatchObject({ source: 'MANUAL', recordedByName: 'Dono Teste' });
    });
  });

  it('transferir para outro dono muda o dono e fica na lista do novo', async () => {
    const buyer = await createCustomer(t.app, owner, { name: 'Comprador' });
    const v = await createVehicle(t.app, owner, customerId, { plate: 'TRF2B34' });
    const res = await post(`/api/v1/vehicles/${v.id}/transfer`, { customerId: buyer.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().customer.name).toBe('Comprador');
    const buyerCars = (await get(`/api/v1/customers/${buyer.id}/vehicles`)).json().data;
    expect(buyerCars.map((c: { id: string }) => c.id)).toEqual([v.id]);
  });

  it('lista filtra por dono e busca por modelo e nome do dono', async () => {
    const org = await signup(t.app);
    const c1 = await createCustomer(t.app, org, { name: 'Zé Oficina' });
    const c2 = await createCustomer(t.app, org, { name: 'Maria Motor' });
    await createVehicle(t.app, org, c1.id, { make: 'Chevrolet', model: 'Onix', plate: 'ONX1A23' });
    await createVehicle(t.app, org, c2.id, { make: 'Volkswagen', model: 'Polo', plate: 'POL2B34' });

    const models = async (url: string) => (await get(url, org)).json().data.map((v: { model: string }) => v.model).sort();
    expect(await models(`/api/v1/vehicles?customerId=${c1.id}`)).toEqual(['Onix']);
    expect(await models('/api/v1/vehicles?q=polo')).toEqual(['Polo']);
    expect(await models('/api/v1/vehicles?q=maria')).toEqual(['Polo']);
    expect(await models('/api/v1/vehicles?q=ONX1')).toEqual(['Onix']);
    expect((await get('/api/v1/vehicles', org)).json().meta.total).toBe(2);
  });

  it('busca global (⌘K) acha cliente e carro pela placa antiga do carro cadastrado como Mercosul', async () => {
    const org = await signup(t.app);
    const c = await createCustomer(t.app, org, { name: 'Cláudio Busca' });
    await createVehicle(t.app, org, c.id, { plate: 'GLB1C23', make: 'Renault', model: 'Sandero' });
    const res = (await get('/api/v1/search?q=GLB-1223', org)).json();
    expect(res.vehicles.map((v: { model: string }) => v.model)).toEqual(['Sandero']);
    expect(res.customers.map((x: { name: string }) => x.name)).toEqual(['Cláudio Busca']);
    const byName = (await get('/api/v1/search?q=claudio', org)).json();
    expect(byName.customers[0]).toMatchObject({ name: 'Cláudio Busca', vehicleCount: 1 });
  });

  describe('permissões e isolamento', () => {
    it('mecânico vê o carro (com o WhatsApp do dono mascarado), mas não cadastra', async () => {
      const v = await createVehicle(t.app, owner, customerId, { plate: 'MEC1A23' });
      const mechanic = await addMember(t.app, owner, 'MECHANIC');
      const read = (await get(`/api/v1/vehicles/${v.id}`, mechanic)).json();
      expect(read.customer.whatsapp).toBe('(11) •••••-4321');
      expect((await post('/api/v1/vehicles', { customerId, make: 'X', model: 'Y' }, mechanic)).statusCode).toBe(403);
      expect((await patch(v.id, { odometerKm: 99 }, mechanic)).statusCode).toBe(403);
    });

    it('outra oficina: não vê o carro, não usa o cliente e não recebe transferência (404)', async () => {
      const v = await createVehicle(t.app, owner, customerId, { plate: 'ISO1A23' });
      const other = await signup(t.app);
      const otherCustomer = await createCustomer(t.app, other, { name: 'De Fora' });

      expect((await get(`/api/v1/vehicles/${v.id}`, other)).statusCode).toBe(404);
      expect((await get('/api/v1/vehicles/lookup?plate=ISO1A23', other)).json().data).toEqual([]);
      expect((await post('/api/v1/vehicles', { customerId, make: 'X', model: 'Y' }, other)).statusCode).toBe(404);
      expect((await post(`/api/v1/vehicles/${v.id}/transfer`, { customerId: otherCustomer.id })).statusCode).toBe(404);
      // e a mesma placa pode existir em outra oficina (cada uma tem o seu cadastro)
      expect((await post('/api/v1/vehicles', { customerId: otherCustomer.id, make: 'X', model: 'Y', plate: 'ISO1A23' }, other)).statusCode).toBe(201);
    });
  });
});
