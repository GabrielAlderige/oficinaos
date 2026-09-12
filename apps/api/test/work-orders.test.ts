import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCustomer,
  createPart,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  type TestApp,
  type TestSession,
  type TestWorkOrder,
} from './helpers';

describe('ordem de serviço', () => {
  let t: TestApp;
  let owner: TestSession;
  let customerId: string;
  let vehicleId: string;
  let serviceId: string;
  let partId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    const customer = await createCustomer(t.app, owner, { name: 'João Pereira', whatsapp: '(11) 98765-4321' });
    customerId = customer.id;
    vehicleId = (await createVehicle(t.app, owner, customerId, { plate: 'ABC1C34' })).id;

    const service = await t.app.inject({
      method: 'POST',
      url: '/api/v1/services',
      headers: bearer(owner.accessToken),
      payload: { name: 'Troca de óleo', priceCents: 12000, estimatedMinutes: 30 },
    });
    serviceId = service.json().id;
    partId = (await createPart(t.app, owner, { name: 'Filtro de óleo', salePriceCents: 3500, initialQuantity: 10, initialUnitCostCents: 2000 })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const get = (url: string, s: TestSession = owner) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const post = (url: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });
  const patch = (url: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload });
  const base = () => ({ customerId, vehicleId });

  describe('abertura', () => {
    it('numera por oficina, em sequência, e começa aberta', async () => {
      const s = await signup(t.app);
      const c = await createCustomer(t.app, s);
      const v = await createVehicle(t.app, s, c.id);
      const first = await createWorkOrder(t.app, s, { customerId: c.id, vehicleId: v.id, complaint: 'Barulho ao frear' });
      const second = await createWorkOrder(t.app, s, { customerId: c.id, vehicleId: v.id });
      expect(first.number).toBe(1);
      expect(second.number).toBe(2);
      expect(first).toMatchObject({ status: 'OPEN', paymentStatus: 'UNPAID', complaint: 'Barulho ao frear' });
      // a oficina nova começa do 1: a numeração é por oficina
      expect((await createWorkOrder(t.app, owner, base())).number).toBeGreaterThan(0);
    });

    it('veículo de outro cliente é recusado', async () => {
      const outro = await createCustomer(t.app, owner, { name: 'Maria' });
      const res = await post('/api/v1/work-orders', { customerId: outro.id, vehicleId });
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0]).toMatchObject({ path: 'body.vehicleId' });
    });

    it('duas pessoas abrindo ao mesmo tempo não repetem número', async () => {
      const s = await signup(t.app);
      const c = await createCustomer(t.app, s);
      const v = await createVehicle(t.app, s, c.id);
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          t.app.inject({ method: 'POST', url: '/api/v1/work-orders', headers: bearer(s.accessToken), payload: { customerId: c.id, vehicleId: v.id } }),
        ),
      );
      expect(results.every((r) => r.statusCode === 201)).toBe(true);
      const numbers = results.map((r) => r.json().number as number).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  describe('itens e totais', () => {
    it('puxa preço, código e marca do catálogo e soma separando peça de serviço', async () => {
      const os = await createWorkOrder(t.app, owner, {
        ...base(),
        items: [
          { type: 'SERVICE', serviceId },
          { type: 'PART', partId, quantity: 2 },
        ],
      });
      expect(os.items).toHaveLength(2);
      expect(os.items[0]).toMatchObject({ description: 'Troca de óleo', totalCents: 12000 });
      expect(os.items[1]).toMatchObject({ description: 'Filtro de óleo', totalCents: 7000 });
      expect(os.totals).toMatchObject({
        servicesSubtotalCents: 12000,
        partsSubtotalCents: 7000,
        subtotalCents: 19000,
        discountCents: 0,
        totalCents: 19000,
      });
    });

    it('item avulso exige preço; com preço, entra', async () => {
      const os = await createWorkOrder(t.app, owner, base());
      const sem = await post(`/api/v1/work-orders/${os.id}/items`, { type: 'SERVICE', description: 'Lavagem do motor' });
      expect(sem.statusCode).toBe(400);
      expect(sem.json().errors[0].path).toBe('body.unitPriceCents');

      const com = await post(`/api/v1/work-orders/${os.id}/items`, {
        type: 'SERVICE',
        description: 'Lavagem do motor',
        unitPriceCents: 8000,
      });
      expect(com.statusCode).toBe(201);
      expect(com.json().totals.totalCents).toBe(8000);
    });

    it('quantidade fracionada e desconto de linha entram na conta', async () => {
      const os = await createWorkOrder(t.app, owner, {
        ...base(),
        items: [{ type: 'PART', partId, quantity: 4.5, unitPriceCents: 4200, discountCents: 900 }],
      });
      // 4,5 × R$ 42,00 = R$ 189,00 − R$ 9,00 = R$ 180,00
      expect(os.items[0]!.totalCents).toBe(18000);
      expect(os.totals.totalCents).toBe(18000);
    });

    it('remover item recalcula o total', async () => {
      const os = await createWorkOrder(t.app, owner, {
        ...base(),
        items: [{ type: 'SERVICE', serviceId }, { type: 'PART', partId }],
      });
      const res = await t.app.inject({
        method: 'DELETE',
        url: `/api/v1/work-orders/${os.id}/items/${os.items[1]!.id}`,
        headers: bearer(owner.accessToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().totals).toMatchObject({ partsSubtotalCents: 0, totalCents: 12000 });
    });

    it('a API ignora total enviado pelo front e recalcula', async () => {
      const os = await createWorkOrder(t.app, owner, { ...base(), items: [{ type: 'SERVICE', serviceId }] });
      const res = await patch(`/api/v1/work-orders/${os.id}/items/${os.items[0]!.id}`, {
        quantity: 3,
        totalCents: 1,
        unitPriceCents: 10000,
      });
      expect(res.json().totals.totalCents).toBe(30000);
      // o total da LINHA também é recalculado e regravado: a OS impressa bate com a soma
      expect(res.json().items[0].totalCents).toBe(30000);
    });
  });

  describe('desconto', () => {
    const withSubtotal = async (s: TestSession = owner): Promise<TestWorkOrder> =>
      createWorkOrder(t.app, s, { ...base(), items: [{ type: 'SERVICE', serviceId, unitPriceCents: 100000 }] });

    it('percentual e valor, com o desconto travado no subtotal', async () => {
      const os = await withSubtotal();
      const percent = await patch(`/api/v1/work-orders/${os.id}`, { version: os.version, discountMode: 'PERCENT', discountValue: 1000 });
      expect(percent.json().totals).toMatchObject({ discountCents: 10000, totalCents: 90000 });

      const exagerado = await patch(`/api/v1/work-orders/${os.id}`, {
        version: percent.json().version,
        discountMode: 'AMOUNT',
        discountValue: 500000,
      });
      expect(exagerado.json().totals).toMatchObject({ discountCents: 100000, totalCents: 0 });
    });

    it('atendente não passa do limite da oficina; gerente não tem limite', async () => {
      const attendant = await addMember(t.app, owner, 'ATTENDANT');
      const os = await withSubtotal();
      const acima = await patch(`/api/v1/work-orders/${os.id}`, { version: os.version, discountMode: 'AMOUNT', discountValue: 15000 }, attendant);
      expect(acima.statusCode).toBe(403);
      expect(acima.json()).toMatchObject({ code: 'DISCOUNT_ABOVE_LIMIT', errors: [{ path: 'body.discountValue' }] });

      const noLimite = await patch(`/api/v1/work-orders/${os.id}`, { version: os.version, discountMode: 'AMOUNT', discountValue: 10000 }, attendant);
      expect(noLimite.statusCode, noLimite.body).toBe(200);

      const manager = await addMember(t.app, owner, 'MANAGER');
      const gerente = await patch(
        `/api/v1/work-orders/${os.id}`,
        { version: noLimite.json().version, discountMode: 'PERCENT', discountValue: 5000 },
        manager,
      );
      expect(gerente.json().totals).toMatchObject({ discountCents: 50000, totalCents: 50000 });
    });
  });

  describe('edição concorrente', () => {
    it('versão velha é recusada com 409, e a nova passa', async () => {
      const os = await createWorkOrder(t.app, owner, base());
      const primeira = await patch(`/api/v1/work-orders/${os.id}`, { version: os.version, diagnosis: 'Pastilha gasta' });
      expect(primeira.statusCode).toBe(200);

      const velha = await patch(`/api/v1/work-orders/${os.id}`, { version: os.version, diagnosis: 'Outro diagnóstico' });
      expect(velha.statusCode).toBe(409);
      expect(velha.json().code).toBe('WORK_ORDER_VERSION_CONFLICT');

      const nova = await patch(`/api/v1/work-orders/${os.id}`, { version: primeira.json().version, diagnosis: 'Pastilha e disco' });
      expect(nova.json().diagnosis).toBe('Pastilha e disco');
    });
  });

  describe('máquina de estados', () => {
    it('diagnóstico anda na ordem e a ação fora de hora dá 409', async () => {
      const os = await createWorkOrder(t.app, owner, base());
      expect((await post(`/api/v1/work-orders/${os.id}/complete`, {})).statusCode).toBe(409);

      const diag = await post(`/api/v1/work-orders/${os.id}/start-diagnosis`, {});
      expect(diag.json().status).toBe('DIAGNOSING');
      const fim = await post(`/api/v1/work-orders/${os.id}/finish-diagnosis`, {});
      expect(fim.json().status).toBe('AWAITING_QUOTE');

      const denovo = await post(`/api/v1/work-orders/${os.id}/start-diagnosis`, {});
      expect(denovo.statusCode).toBe(409);
      expect(denovo.json().code).toBe('INVALID_TRANSITION');
    });

    it('cancelar exige motivo, registra e fecha a OS para mudanças', async () => {
      const os = await createWorkOrder(t.app, owner, { ...base(), items: [{ type: 'SERVICE', serviceId }] });
      const semMotivo = await post(`/api/v1/work-orders/${os.id}/cancel`, {});
      expect(semMotivo.statusCode).toBe(400);

      const cancelada = await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'Cliente desistiu do serviço' });
      expect(cancelada.json()).toMatchObject({ status: 'CANCELED', cancelReason: 'Cliente desistiu do serviço' });

      const depois = await post(`/api/v1/work-orders/${os.id}/items`, { type: 'SERVICE', serviceId });
      expect(depois.statusCode).toBe(409);
      expect(depois.json().code).toBe('WORK_ORDER_NOT_EDITABLE');
    });

    it('mecânico mexe no diagnóstico, mas não entrega nem cancela', async () => {
      const mechanic = await addMember(t.app, owner, 'MECHANIC');
      const os = await createWorkOrder(t.app, owner, base());
      expect((await post(`/api/v1/work-orders/${os.id}/start-diagnosis`, {}, mechanic)).statusCode).toBe(200);
      expect((await post(`/api/v1/work-orders/${os.id}/deliver`, {}, mechanic)).statusCode).toBe(403);
      expect((await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'qualquer motivo' }, mechanic)).statusCode).toBe(403);
    });
  });

  describe('timeline e check-in', () => {
    it('a timeline conta o que aconteceu, na ordem inversa', async () => {
      const os = await createWorkOrder(t.app, owner, base());
      await post(`/api/v1/work-orders/${os.id}/start-diagnosis`, {});
      await post(`/api/v1/work-orders/${os.id}/notes`, { text: 'Cliente autorizou por telefone' });

      const events = (await get(`/api/v1/work-orders/${os.id}/timeline`)).json().data as { type: string; actorName: string | null; data: Record<string, unknown> }[];
      expect(events.map((e) => e.type)).toEqual(['NOTE', 'STATUS_CHANGED', 'CREATED']);
      expect(events[0]).toMatchObject({ actorName: 'Dono Teste', data: { text: 'Cliente autorizou por telefone' } });
      expect(events[1]!.data).toMatchObject({ from: 'OPEN', to: 'DIAGNOSING' });
    });

    it('check-in guarda checklist, avaria, combustível e atualiza o km da OS', async () => {
      const os = await createWorkOrder(t.app, owner, base());
      const res = await post(`/api/v1/work-orders/${os.id}/inspections`, {
        type: 'CHECK_IN',
        odometerKm: 82000,
        fuelLevel: 4,
        checklist: [
          { key: 'tires', label: 'Pneus e estepe', state: 'ISSUE', note: 'Dianteiros gastos' },
          { key: 'lights', label: 'Faróis e lanternas', state: 'OK' },
        ],
        damages: [{ zone: 'FRONT_LEFT', kind: 'SCRATCH', note: 'Risco na porta' }],
        accessories: ['Estepe', 'Macaco'],
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toMatchObject({ type: 'CHECK_IN', odometerKm: 82000, fuelLevel: 4, accessories: ['Estepe', 'Macaco'] });

      expect((await get(`/api/v1/work-orders/${os.number}`)).json().odometerKm).toBe(82000);
      const events = (await get(`/api/v1/work-orders/${os.id}/timeline`)).json().data as { type: string; data: Record<string, unknown> }[];
      expect(events[0]).toMatchObject({ type: 'CHECK_IN', data: { issues: 1, damages: 1 } });
    });

    it('o km do check-in vira o km do veículo, com histórico', async () => {
      const c = await createCustomer(t.app, owner, { name: 'Dona do Corsa' });
      const v = await createVehicle(t.app, owner, c.id, { plate: 'KMS1A11', odometerKm: 50000 });
      const os = await createWorkOrder(t.app, owner, { customerId: c.id, vehicleId: v.id });

      const res = await post(`/api/v1/work-orders/${os.id}/inspections`, { type: 'CHECK_IN', odometerKm: 61000 });
      expect(res.statusCode, res.body).toBe(201);

      const vehicle = (await get(`/api/v1/vehicles/${v.id}`)).json();
      expect(vehicle.odometerKm).toBe(61000);
      const readings = (await get(`/api/v1/vehicles/${v.id}/odometer-readings`)).json().data as { km: number; source: string }[];
      expect(readings[0]).toMatchObject({ km: 61000, source: 'CHECK_IN' });
    });

    it('km menor que o último pede confirmação (mesma regra do cadastro)', async () => {
      const c = await createCustomer(t.app, owner, { name: 'Dono do Gol' });
      const v = await createVehicle(t.app, owner, c.id, { plate: 'KMS2B22', odometerKm: 90000 });
      const os = await createWorkOrder(t.app, owner, { customerId: c.id, vehicleId: v.id });

      const recusado = await post(`/api/v1/work-orders/${os.id}/inspections`, { type: 'CHECK_IN', odometerKm: 80000 });
      expect(recusado.statusCode).toBe(422);
      expect(recusado.json()).toMatchObject({ code: 'ODOMETER_DECREASE', errors: [{ path: 'body.odometerKm' }] });

      const confirmado = await post(`/api/v1/work-orders/${os.id}/inspections`, {
        type: 'CHECK_IN',
        odometerKm: 80000,
        confirmOdometerDecrease: true,
      });
      expect(confirmado.statusCode).toBe(201);
      expect((await get(`/api/v1/vehicles/${v.id}`)).json().odometerKm).toBe(80000);
    });
  });

  describe('listagem, quadro e permissões', () => {
    it('lista por situação e acha pela placa e pelo número', async () => {
      const s = await signup(t.app);
      const c = await createCustomer(t.app, s, { name: 'Carlos Souza' });
      const v = await createVehicle(t.app, s, c.id, { plate: 'XYZ9A88' });
      const os = await createWorkOrder(t.app, s, { customerId: c.id, vehicleId: v.id });
      await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'Teste de filtro' }, s);
      const aberta = await createWorkOrder(t.app, s, { customerId: c.id, vehicleId: v.id });

      const ativas = (await get('/api/v1/work-orders', s)).json();
      expect(ativas.data.map((o: { number: number }) => o.number)).toEqual([aberta.number]);
      expect((await get('/api/v1/work-orders?status=CANCELED', s)).json().data).toHaveLength(1);
      expect((await get('/api/v1/work-orders?status=all', s)).json().meta.total).toBe(2);
      expect((await get('/api/v1/work-orders?q=XYZ9A88', s)).json().data).toHaveLength(1);
      expect((await get(`/api/v1/work-orders?q=${aberta.number}&status=all`, s)).json().data[0].number).toBe(aberta.number);
      expect((await get('/api/v1/work-orders?q=carlos', s)).json().data).toHaveLength(1);

      const board = (await get('/api/v1/work-orders/board', s)).json();
      expect(board.activeTotal).toBe(1);
      expect(board.counts).toEqual(expect.arrayContaining([{ status: 'CANCELED', count: 1 }, { status: 'OPEN', count: 1 }]));
    });

    it('mecânico não vê o custo da peça na OS; financeiro vê', async () => {
      const os = await createWorkOrder(t.app, owner, { ...base(), items: [{ type: 'PART', partId }] });
      const mechanic = await addMember(t.app, owner, 'MECHANIC');
      const doMecanico = (await get(`/api/v1/work-orders/${os.number}`, mechanic)).json();
      expect(doMecanico.items[0]).toMatchObject({ unitCostCents: null, unitPriceCents: 3500 });

      const finance = await addMember(t.app, owner, 'FINANCE');
      expect((await get(`/api/v1/work-orders/${os.number}`, finance)).json().items[0].unitCostCents).toBe(2000);
    });

    it('financeiro só olha: não abre nem edita OS', async () => {
      const finance = await addMember(t.app, owner, 'FINANCE');
      expect((await post('/api/v1/work-orders', base(), finance)).statusCode).toBe(403);
    });

    it('outra oficina não vê a OS (404)', async () => {
      const os = await createWorkOrder(t.app, owner, base());
      const other = await signup(t.app);
      expect((await get(`/api/v1/work-orders/${os.number}`, other)).statusCode).toBe(404);
      expect((await post(`/api/v1/work-orders/${os.id}/items`, { type: 'SERVICE', serviceId }, other)).statusCode).toBe(404);
      expect((await get('/api/v1/work-orders?status=all', other)).json().data).toEqual([]);
    });
  });
});
