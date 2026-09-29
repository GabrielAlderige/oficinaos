import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createCustomer,
  createPart,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

interface Pacote {
  id: string;
  name: string;
  isActive: boolean;
  totalCents: number;
  items: { kind: string; name: string; quantity: number; unitPriceCents: number | null; unavailable: boolean }[];
}

/**
 * Pacotes de serviço (E27).
 *
 * O que precisa ficar provado: o pacote leva serviço E peça, o preço é o do
 * catálogo **no dia em que se usa** (e não o do dia em que foi montado), cada
 * linha cai editável na OS, e o mesmo POST repetido não joga tudo duas vezes.
 */
describe('pacotes de serviço', () => {
  let t: TestApp;
  let dono: TestSession;
  let servico: string;
  let peca: string;
  let pacote: Pacote;
  let sequencia = 0;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const patch = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  async function osVazia() {
    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira' });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: `PCT${1000 + sequencia++}` });
    return createWorkOrder(t.app, dono, { customerId: cliente.id, vehicleId: veiculo.id, items: [] });
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    servico = ((await post('/api/v1/services', { name: 'Troca de óleo', priceCents: 9_000 })).json() as { id: string })
      .id;
    peca = (await createPart(t.app, dono, { name: 'Óleo 5W30', salePriceCents: 4_500, initialQuantity: 20 })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('o pacote leva serviço e peça, e soma o preço de hoje', async () => {
    const criado = await post('/api/v1/service-packages', {
      name: 'Revisão dos 10.000 km',
      description: 'Óleo, filtro e revisão de freios',
      items: [
        { serviceId: servico, quantity: 1 },
        { partId: peca, quantity: 4 },
      ],
    });
    expect(criado.statusCode, criado.body).toBe(201);
    pacote = criado.json() as Pacote;

    expect(pacote.items.map((item) => item.kind)).toEqual(['SERVICE', 'PART']);
    expect(pacote.items[1]!.quantity).toBe(4);
    expect(pacote.totalCents, 'R$ 90 de serviço + 4 × R$ 45 de óleo').toBe(27_000);
  });

  it('mudou o preço no catálogo, mudou o pacote — sem mexer no pacote', async () => {
    await patch(`/api/v1/parts/${peca}`, { salePriceCents: 5_000 });
    const depois = (await get(`/api/v1/service-packages/${pacote.id}`)).json() as Pacote;
    expect(depois.totalCents, 'R$ 90 + 4 × R$ 50').toBe(29_000);
  });

  it('linha com serviço E peça na mesma linha é recusada', async () => {
    const res = await post('/api/v1/service-packages', {
      name: 'Confuso',
      items: [{ serviceId: servico, partId: peca, quantity: 1 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('o pacote cai na OS como itens normais, editáveis', async () => {
    const os = await osVazia();
    const aplicado = await post(`/api/v1/work-orders/${os.id}/packages`, {
      packageId: pacote.id,
      clientRequestId: randomUUID(),
    });
    expect(aplicado.statusCode, aplicado.body).toBe(201);

    const atualizada = aplicado.json() as {
      items: { id: string; type: string; description: string; quantity: number; unitPriceCents: number }[];
      totals: { totalCents: number };
    };
    expect(atualizada.items).toHaveLength(2);
    expect(atualizada.items[0]!.description).toBe('Troca de óleo');
    expect(atualizada.items[1]!.quantity).toBe(4);
    expect(atualizada.totals.totalCents).toBe(29_000);

    // e a linha é editável como qualquer outra: o pacote não amarra o orçamento
    const editada = await patch(`/api/v1/work-orders/${os.id}/items/${atualizada.items[1]!.id}`, {
      quantity: 5,
      unitPriceCents: 4_800,
    });
    expect(editada.statusCode, editada.body).toBe(200);
    expect((editada.json() as { totals: { totalCents: number } }).totals.totalCents, 'R$ 90 + 5 × R$ 48').toBe(33_000);
  });

  it('o mesmo POST repetido não joga o pacote duas vezes', async () => {
    const os = await osVazia();
    const mesmoPedido = randomUUID();
    await post(`/api/v1/work-orders/${os.id}/packages`, { packageId: pacote.id, clientRequestId: mesmoPedido });
    const segundo = await post(`/api/v1/work-orders/${os.id}/packages`, {
      packageId: pacote.id,
      clientRequestId: mesmoPedido,
    });
    expect(segundo.statusCode).toBe(201);
    expect((segundo.json() as { items: unknown[] }).items, 'os mesmos dois itens').toHaveLength(2);
  });

  it('pacote desativado não entra em OS nova, e some da lista', async () => {
    await patch(`/api/v1/service-packages/${pacote.id}`, { isActive: false });
    const lista = (await get('/api/v1/service-packages')).json() as { data: Pacote[] };
    expect(lista.data.some((p) => p.id === pacote.id), 'sumiu da lista de uso').toBe(false);

    const os = await osVazia();
    const res = await post(`/api/v1/work-orders/${os.id}/packages`, {
      packageId: pacote.id,
      clientRequestId: randomUUID(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().title).toBe('Pacote desativado');

    await patch(`/api/v1/service-packages/${pacote.id}`, { isActive: true });
  });

  it('peça excluída do catálogo aparece marcada, sem quebrar o pacote', async () => {
    const descartavel = await createPart(t.app, dono, { name: 'Filtro velho', salePriceCents: 3_000 });
    const criado = (
      await post('/api/v1/service-packages', {
        name: 'Com peça que vai sumir',
        items: [{ partId: descartavel.id, quantity: 1 }],
      })
    ).json() as Pacote;

    await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/parts/${descartavel.id}`,
      headers: bearer(dono.accessToken),
    });

    const depois = (await get(`/api/v1/service-packages/${criado.id}`)).json() as Pacote;
    expect(depois.items[0]!.unavailable, 'a tela avisa em vez de somar errado').toBe(true);
    expect(depois.totalCents, 'e o que sumiu não entra no total').toBe(0);
  });
});
