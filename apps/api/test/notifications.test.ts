import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  nextIp,
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

interface TestNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
}
interface TestNotificationList {
  data: TestNotification[];
  unreadCount: number;
}

/**
 * O sino do painel (ARCHITECTURE §8.1): é por ele que a oficina descobre que o
 * cliente abriu ou respondeu. O RLS isola a OFICINA; quem separa a caixa de uma
 * pessoa da do colega é o filtro por userId — e é isso que estes testes seguram.
 */
describe('avisos do painel', () => {
  let t: TestApp;
  let owner: TestSession;
  let atendente: TestSession;
  let mecanico: TestSession;
  let serviceId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    atendente = await addMember(t.app, owner, 'ATTENDANT', 'Ana do Balcão');
    mecanico = await addMember(t.app, owner, 'MECHANIC', 'Zé Mecânico');
    const service = await t.app.inject({
      method: 'POST',
      url: '/api/v1/services',
      headers: bearer(owner.accessToken),
      payload: { name: 'Troca de pastilhas', priceCents: 18000 },
    });
    serviceId = service.json().id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  let placas = 0;
  function nextPlate(): string {
    placas += 1;
    return `AVS${placas % 10}A${String(placas % 100).padStart(2, '0')}`;
  }

  const avisos = async (s: TestSession): Promise<TestNotificationList> =>
    (
      await t.app.inject({ method: 'GET', url: '/api/v1/notifications', headers: bearer(s.accessToken) })
    ).json() as TestNotificationList;

  /** OS com um serviço, já orçada e com o link pronto para o cliente abrir. */
  async function orcamentoEnviado() {
    const customer = await createCustomer(t.app, owner, { name: 'João Pereira' });
    const vehicle = await createVehicle(t.app, owner, customer.id, { plate: nextPlate() });
    const order = await createWorkOrder(t.app, owner, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      items: [{ type: 'SERVICE', serviceId }],
    });
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/work-orders/${order.id}/quotes`,
      headers: bearer(owner.accessToken),
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(201);
    const quote = res.json() as { publicUrl: string };
    return { order, token: quote.publicUrl.split('/').pop() as string };
  }

  const abrirLink = (token: string) =>
    t.app.inject({ method: 'GET', url: `/api/v1/public/quotes/${token}`, remoteAddress: nextIp() });

  it('o cliente abre o link e quem cuida de orçamento é avisado, cada um na sua caixa', async () => {
    const { order, token } = await orcamentoEnviado();
    expect((await abrirLink(token)).statusCode).toBe(200);

    const doDono = await avisos(owner);
    expect(doDono.unreadCount).toBe(1);
    expect(doDono.data[0]).toMatchObject({ type: 'QUOTE_VIEWED', link: `/ordens/${order.number}` });

    // o atendente recebe a cópia DELE, não a mesma linha do dono
    const doAtendente = await avisos(atendente);
    expect(doAtendente.unreadCount).toBe(1);
    const doDonoPrimeiro = doDono.data[0] as TestNotification;
    const doAtendentePrimeiro = doAtendente.data[0] as TestNotification;
    expect(doAtendentePrimeiro.id).not.toBe(doDonoPrimeiro.id);

    // o mecânico não cuida de orçamento (§7): não recebe
    expect((await avisos(mecanico)).unreadCount).toBe(0);
  });

  it('marcar tudo como lido mexe só na caixa de quem marcou', async () => {
    const { token } = await orcamentoEnviado();
    await abrirLink(token);

    const antesDoAtendente = (await avisos(atendente)).unreadCount;
    expect(antesDoAtendente).toBeGreaterThan(0);

    const marcou = await t.app.inject({
      method: 'POST',
      url: '/api/v1/notifications/read',
      headers: bearer(owner.accessToken),
    });
    expect(marcou.statusCode, marcou.body).toBe(200);
    expect((marcou.json() as TestNotificationList).unreadCount).toBe(0);

    expect((await avisos(owner)).unreadCount).toBe(0);
    // o colega continua com os dele: a caixa é de cada um
    expect((await avisos(atendente)).unreadCount).toBe(antesDoAtendente);
  });

  it('a resposta do cliente vira aviso com link para a OS', async () => {
    const { order, token } = await orcamentoEnviado();
    const publico = (await abrirLink(token)).json() as {
      contentHash: string;
      items: { id: string }[];
    };

    const aprovou = await t.app.inject({
      method: 'POST',
      url: `/api/v1/public/quotes/${token}/approve`,
      remoteAddress: nextIp(),
      payload: {
        approvedItemIds: publico.items.map((item) => item.id),
        signerName: 'João Pereira',
        accepted: true,
        contentHash: publico.contentHash,
      },
    });
    expect(aprovou.statusCode, aprovou.body).toBe(200);

    const doDono = await avisos(owner);
    expect(doDono.data[0]).toMatchObject({ type: 'QUOTE_APPROVED', link: `/ordens/${order.number}` });
  });

  it('marcar um aviso não marca os outros', async () => {
    const primeiro = await orcamentoEnviado();
    await abrirLink(primeiro.token);
    const segundo = await orcamentoEnviado();
    await abrirLink(segundo.token);

    const antes = await avisos(owner);
    expect(antes.unreadCount).toBeGreaterThanOrEqual(2);
    const alvo = antes.data.find((aviso) => aviso.readAt === null) as TestNotification;

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${alvo.id}/read`,
      headers: bearer(owner.accessToken),
    });
    expect(res.statusCode, res.body).toBe(204);

    const depois = await avisos(owner);
    expect(depois.unreadCount).toBe(antes.unreadCount - 1);
    expect(depois.data.find((aviso) => aviso.id === alvo.id)?.readAt).not.toBeNull();
  });
});
