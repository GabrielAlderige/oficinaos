import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

interface Modelo {
  id: string;
  name: string;
  position: number;
  items: { key: string; label: string }[];
}

/**
 * Checklists da oficina (E49).
 *
 * O que precisa ficar provado: a oficina monta e ordena os seus modelos, o
 * check-in grava o checklist inteiro (mudar o modelo depois não reescreve o
 * check-in feito), apagar some da lista sem estragar o passado, e o mecânico
 * lê mas não edita.
 */
describe('checklists da oficina', () => {
  let t: TestApp;
  let dono: TestSession;
  let mecanico: TestSession;
  let revisao: Modelo;
  let ar: Modelo;

  const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, s: TestSession = dono) =>
    t.app.inject({ method, url, headers: bearer(s.accessToken), ...(payload === undefined ? {} : { payload: payload as never }) });
  const lista = async (s: TestSession = dono) => (await req('GET', '/api/v1/checklist-templates', undefined, s)).json().data as Modelo[];

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé');
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('oficina nova não tem modelo: o check-in usa o padrão do sistema', async () => {
    expect(await lista()).toEqual([]);
  });

  it('cria modelos com os itens na ordem montada, e a chave sai do rótulo', async () => {
    const criado = await req('POST', '/api/v1/checklist-templates', {
      name: 'Revisão',
      items: [{ label: 'Óleo e filtro' }, { label: 'Freios' }, { label: 'Freios' }],
    });
    expect(criado.statusCode, criado.body).toBe(201);
    revisao = criado.json() as Modelo;
    expect(revisao.items.map((item) => item.key)).toEqual(['oleo-e-filtro', 'freios', 'freios-2']);

    ar = (await req('POST', '/api/v1/checklist-templates', { name: 'Ar-condicionado', items: [{ label: 'Pressão do gás' }] })).json();
    expect((await lista()).map((m) => m.name)).toEqual(['Revisão', 'Ar-condicionado']);
  });

  it('reordena: o primeiro é o que o check-in sugere', async () => {
    const res = await req('POST', '/api/v1/checklist-templates/order', { ids: [ar.id, revisao.id] });
    expect(res.statusCode, res.body).toBe(200);
    expect((await lista()).map((m) => m.name)).toEqual(['Ar-condicionado', 'Revisão']);
  });

  it('o check-in grava o checklist inteiro: mudar o modelo depois não reescreve o passado', async () => {
    const cliente = await createCustomer(t.app, dono, { name: 'Lia' });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: 'CHK1A23' });
    const os = await createWorkOrder(t.app, dono, { customerId: cliente.id, vehicleId: veiculo.id, items: [] });
    const feito = await req('POST', `/api/v1/work-orders/${os.id}/inspections`, {
      type: 'CHECK_IN',
      odometerKm: 50_000,
      checklist: revisao.items.map((item) => ({ ...item, state: 'OK', note: '' })),
    });
    expect(feito.statusCode, feito.body).toBe(201);

    await req('PUT', `/api/v1/checklist-templates/${revisao.id}`, { name: 'Revisão completa', items: [{ label: 'Só um item agora' }] });

    const inspecoes = (await req('GET', `/api/v1/work-orders/${os.id}/inspections`)).json().data as {
      checklist: { label: string }[];
    }[];
    expect(inspecoes[0]!.checklist.map((item) => item.label)).toEqual(['Óleo e filtro', 'Freios', 'Freios']);
  });

  it('apagar some da lista', async () => {
    expect((await req('DELETE', `/api/v1/checklist-templates/${ar.id}`)).statusCode).toBe(200);
    expect((await lista()).map((m) => m.name)).toEqual(['Revisão completa']);
    expect((await req('PUT', `/api/v1/checklist-templates/${ar.id}`, { name: 'Volta', items: [{ label: 'x item' }] })).statusCode).toBe(
      404,
    );
  });

  it('o mecânico lê os modelos mas não monta', async () => {
    expect((await lista(mecanico)).length).toBe(1);
    const tentativa = await req('POST', '/api/v1/checklist-templates', { name: 'Meu', items: [{ label: 'Item' }] }, mecanico);
    expect(tentativa.statusCode).toBe(403);
  });

  it('outra oficina não vê nem mexe', async () => {
    const outra = await signup(t.app);
    expect(await lista(outra)).toEqual([]);
    expect((await req('DELETE', `/api/v1/checklist-templates/${revisao.id}`, undefined, outra)).statusCode).toBe(404);
  });
});
