import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  nextIp,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

interface Contato {
  id: string;
  type: string;
  status: string;
  dueOn: string;
  lateDays: number;
  reason: string | null;
  customerName: string;
  vehicleLabel: string | null;
  workOrderNumber: number | null;
  message: string;
  whatsappUrl: string | null;
}

interface Funil {
  stages: { stage: string; count: number; valueCents: number; leads: { id: string; name: string; stage: string }[] }[];
  openValueCents: number;
  conversionBps: number;
}

/**
 * Pós-venda, avaliações e CRM (E16). O que precisa ficar provado: a fila se
 * monta sozinha e não duplica, o convite de avaliação só existe depois da
 * entrega e o link abre sem sessão, a nota entra uma vez só, e o funil cobra
 * motivo de perda e vira cliente ao fechar.
 */
describe('pós-venda, avaliações e funil', () => {
  let t: TestApp;
  let dono: TestSession;
  let atendente: TestSession;
  let mecanico: TestSession;
  let clienteId: string;
  let carroId: string;
  let servicoId: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const patch = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const publico = (url: string, payload?: unknown) =>
    t.app.inject({
      method: payload ? 'POST' : 'GET',
      url,
      payload: payload as never,
      remoteAddress: nextIp(),
      headers: { 'user-agent': 'Celular do cliente' },
    });

  /** OS entregue de verdade: é o que dá origem ao pós-venda e à avaliação. */
  async function osEntregue(placa: string) {
    const carro = await createVehicle(t.app, dono, clienteId, { plate: placa, make: 'Fiat', model: 'Argo' });
    const os = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: carro.id,
      items: [{ type: 'SERVICE', serviceId: servicoId }],
    });
    const orcamento = (await post(`/api/v1/work-orders/${os.id}/quotes`, {})).json() as { id: string };
    await post(`/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await post(`/api/v1/work-orders/${os.id}/start`);
    await post(`/api/v1/work-orders/${os.id}/complete`);
    await post(`/api/v1/work-orders/${os.id}/payments`, { method: 'PIX', amountCents: 16_000 });
    expect((await post(`/api/v1/work-orders/${os.id}/deliver`)).statusCode).toBe(200);
    return os;
  }

  /**
   * Empurra a entrega para o passado: o pós-venda entra na fila 7 dias depois.
   * Com RLS FORÇADO, um UPDATE sem contexto de oficina não dá erro — ele
   * simplesmente não acha linha nenhuma (armadilha da E9). Daí o `withTenant`.
   */
  async function entregaHaDias(workOrderId: string, dias: number) {
    await withTenant(testDb().db, { organizationId: dono.orgId }, (tx) =>
      tx.execute(sql`
        update work_orders set delivered_at = now() - make_interval(days => ${dias}),
                               completed_at = now() - make_interval(days => ${dias})
        where id = ${workOrderId}
      `),
    );
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    servicoId = (await post('/api/v1/services', { name: 'Troca de óleo', priceCents: 16_000, intervalMonths: 6 })).json().id;
    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira', whatsapp: '(11) 91234-5678' });
    clienteId = cliente.id;
    carroId = (await createVehicle(t.app, dono, clienteId, { plate: 'PVE1A23', make: 'VW', model: 'Gol' })).id;
    void carroId;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ============================== pós-venda ==================================

  it('a fila se monta sozinha uma semana depois da entrega, com a mensagem pronta', async () => {
    const os = await osEntregue('PVE2B34');
    const vazia = (await get('/api/v1/follow-ups?filter=today')).json() as { data: Contato[] };
    expect(vazia.data.some((item) => item.workOrderNumber === os.number), 'ainda não faz uma semana').toBe(false);

    await entregaHaDias(os.id, 8);
    const res = await get('/api/v1/follow-ups?filter=today');
    expect(res.statusCode, res.body).toBe(200);
    const fila = res.json() as { data: Contato[]; counts: { today: number; late: number } };
    const contato = fila.data.find((item) => item.workOrderNumber === os.number)!;
    expect(contato, 'o pós-venda entrou na fila').toBeTruthy();
    expect(contato.type).toBe('POST_SALE_7D');
    expect(contato.customerName).toBe('João Pereira');
    expect(contato.message).toContain('Olá, João!');
    expect(contato.message).toContain('Está tudo certo com o carro?');
    expect(contato.whatsappUrl).toContain('wa.me/5511912345678');
    expect(contato.lateDays, 'entregue há 8 dias: um dia de atraso na fila').toBe(1);
  });

  it('abrir a fila de novo não duplica o mesmo contato', async () => {
    const primeira = (await get('/api/v1/follow-ups?filter=all')).json() as { data: Contato[] };
    const segunda = (await get('/api/v1/follow-ups?filter=all')).json() as { data: Contato[] };
    expect(segunda.data.length).toBe(primeira.data.length);
    const ids = segunda.data.map((item) => item.id);
    expect(new Set(ids).size, 'nenhum id repetido').toBe(ids.length);
  });

  it('"já falei" tira da fila e guarda o que aconteceu; "não precisa" também', async () => {
    const fila = (await get('/api/v1/follow-ups?filter=today')).json() as { data: Contato[] };
    const alvo = fila.data[0]!;
    const feito = await post(`/api/v1/follow-ups/${alvo.id}/done`, { outcome: 'Vai trazer o carro na terça' });
    expect(feito.statusCode, feito.body).toBe(200);

    const depois = (await get('/api/v1/follow-ups?filter=today')).json() as { data: Contato[] };
    expect(depois.data.some((item) => item.id === alvo.id), 'saiu da fila de hoje').toBe(false);

    const historico = (await get('/api/v1/follow-ups?filter=done')).json() as { data: Contato[] };
    const registrado = historico.data.find((item) => item.id === alvo.id)!;
    expect(registrado.status).toBe('DONE');
    expect(registrado.reason).toBeTruthy();
  });

  it('o atendente cuida da fila; o mecânico não vê (a fila mostra o contato do cliente)', async () => {
    expect((await get('/api/v1/follow-ups', atendente)).statusCode).toBe(200);
    expect((await get('/api/v1/follow-ups', mecanico)).statusCode).toBe(403);
    expect((await post('/api/v1/leads', { name: 'Tentativa' }, mecanico)).statusCode).toBe(403);
  });

  // ============================== avaliações =================================

  it('a avaliação só é pedida depois da entrega, e o link abre sem sessão', async () => {
    const aberta = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: (await createVehicle(t.app, dono, clienteId, { plate: 'PVE3C45', make: 'Fiat', model: 'Uno' })).id,
      items: [{ type: 'SERVICE', serviceId: servicoId }],
    });
    const cedoDemais = await post(`/api/v1/work-orders/${aberta.id}/review-invite`);
    expect(cedoDemais.statusCode).toBe(422);
    expect(cedoDemais.json().code).toBe('INVALID_TRANSITION');

    const os = await osEntregue('PVE4D56');
    const convite = await post(`/api/v1/work-orders/${os.id}/review-invite`);
    expect(convite.statusCode, convite.body).toBe(201);
    const { publicUrl, message, whatsappUrl } = convite.json() as {
      publicUrl: string;
      message: string;
      whatsappUrl: string;
    };
    expect(message).toContain(publicUrl);
    expect(whatsappUrl).toContain('wa.me/');

    const token = publicUrl.slice(publicUrl.lastIndexOf('/') + 1);
    const pagina = await publico(`/api/v1/public/reviews/${token}`);
    expect(pagina.statusCode, pagina.body).toBe(200);
    expect(pagina.json()).toMatchObject({ submitted: false, workOrderNumber: os.number, googleReviewUrl: null });

    // a nota entra uma vez só
    const enviou = await publico(`/api/v1/public/reviews/${token}`, { rating: 5, comment: 'Atendimento rápido' });
    expect(enviou.statusCode, enviou.body).toBe(200);
    expect(enviou.json()).toMatchObject({ submitted: true, rating: 5 });

    const denovo = await publico(`/api/v1/public/reviews/${token}`, { rating: 1, comment: 'mudei de ideia' });
    expect(denovo.statusCode).toBe(409);
    expect((await publico(`/api/v1/public/reviews/${token}`)).json().rating).toBe(5);

    // e o painel mostra a média
    const resumo = (await get('/api/v1/reviews/summary')).json() as {
      average: number;
      total: number;
      latest: { rating: number; comment: string | null }[];
    };
    expect(resumo.total).toBe(1);
    expect(resumo.average).toBe(5);
    expect(resumo.latest[0]).toMatchObject({ rating: 5, comment: 'Atendimento rápido' });
  });

  it('o link do Google aparece na página quando a oficina configura', async () => {
    const os = await osEntregue('PVE5E67');
    const { publicUrl } = (await post(`/api/v1/work-orders/${os.id}/review-invite`)).json() as { publicUrl: string };
    const token = publicUrl.slice(publicUrl.lastIndexOf('/') + 1);

    const salvou = await patch('/api/v1/organization/settings', { googleReviewUrl: 'https://g.page/r/oficina-teste' });
    expect(salvou.statusCode, salvou.body).toBe(200);
    expect((await publico(`/api/v1/public/reviews/${token}`)).json().googleReviewUrl).toBe('https://g.page/r/oficina-teste');
  });

  it('token inventado não abre avaliação nenhuma', async () => {
    const res = await publico('/api/v1/public/reviews/naoexistemesmo-000000000000000000000');
    expect(res.statusCode).toBe(404);
  });

  // ================================= funil ===================================

  it('o funil anda por etapa, cobra motivo de perda e calcula a conversão', async () => {
    const criado = await post('/api/v1/leads', {
      name: 'Carlos Lima',
      phone: '(11) 98888-7777',
      source: 'WHATSAPP',
      vehicleDesc: 'Corolla 2018',
      need: 'Barulho na suspensão',
      estimatedValueCents: 120_000,
    });
    expect(criado.statusCode, criado.body).toBe(201);
    const lead = criado.json() as { id: string; stage: string };
    expect(lead.stage).toBe('NEW');

    expect((await post(`/api/v1/leads/${lead.id}/stage`, { stage: 'CONTACTED' })).statusCode).toBe(200);
    const semMotivo = await post(`/api/v1/leads/${lead.id}/stage`, { stage: 'LOST' });
    expect(semMotivo.statusCode, 'perder exige motivo').toBe(422);

    const perdido = await post('/api/v1/leads', { name: 'Ana Paula', estimatedValueCents: 50_000 });
    const perdidoId = (perdido.json() as { id: string }).id;
    expect((await post(`/api/v1/leads/${perdidoId}/stage`, { stage: 'LOST', lostReason: 'Achou caro' })).statusCode).toBe(200);

    expect((await post(`/api/v1/leads/${lead.id}/stage`, { stage: 'WON' })).statusCode).toBe(200);

    const funil = (await get('/api/v1/leads')).json() as Funil;
    // 1 ganho e 1 perdido = 50% de conversão
    expect(funil.conversionBps).toBe(5_000);
    expect(funil.stages.find((etapa) => etapa.stage === 'LOST')!.count).toBe(1);
    expect(funil.openValueCents, 'ganho e perdido saem do que está em aberto').toBe(0);
  });

  it('fechar o contato cria o cliente, com o telefone que já estava ali', async () => {
    const lead = (await post('/api/v1/leads', {
      name: 'Marcos Vieira',
      phone: '(11) 97777-6666',
      need: 'Revisão completa',
    })).json() as { id: string };
    expect((await post(`/api/v1/leads/${lead.id}/stage`, { stage: 'WON' })).statusCode).toBe(200);

    const convertido = await post(`/api/v1/leads/${lead.id}/convert`, { customerId: null });
    expect(convertido.statusCode, convertido.body).toBe(200);
    const comCliente = convertido.json() as { customerId: string; customerName: string };
    expect(comCliente.customerId).toBeTruthy();
    expect(comCliente.customerName).toBe('Marcos Vieira');

    const cliente = await get(`/api/v1/customers/${comCliente.customerId}`);
    expect(cliente.statusCode, cliente.body).toBe(200);
    expect(cliente.json().whatsapp).toBe('+5511977776666');

    // e não converte duas vezes
    expect((await post(`/api/v1/leads/${lead.id}/convert`, { customerId: null })).statusCode).toBe(409);
  });

  // =========================== acompanhe seu veículo ==========================

  it('o link de acompanhamento abre sem sessão e mostra só o que é do cliente', async () => {
    const os = await osEntregue('PVE6F78');
    const link = await post(`/api/v1/work-orders/${os.id}/tracking-link`);
    expect(link.statusCode, link.body).toBe(201);
    const { publicUrl, message } = link.json() as { publicUrl: string; message: string };
    expect(message).toContain(publicUrl);

    const token = publicUrl.slice(publicUrl.lastIndexOf('/') + 1);
    const pagina = await publico(`/api/v1/public/tracking/${token}`);
    expect(pagina.statusCode, pagina.body).toBe(200);
    const corpo = pagina.json() as {
      number: number;
      status: string;
      headline: string;
      steps: { key: string; done: boolean; current: boolean }[];
      approvedTotalCents: number | null;
      vehicleLabel: string;
    };
    expect(corpo.number).toBe(os.number);
    expect(corpo.status).toBe('DELIVERED');
    expect(corpo.headline).toContain('entregue');
    expect(corpo.steps.find((passo) => passo.key === 'entregue')!.current).toBe(true);
    expect(corpo.approvedTotalCents).toBe(16_000);
    expect(corpo.vehicleLabel, 'placa Mercosul sai sem hífen').toContain('PVE6F78');
    // nada de custo, margem ou observação interna na página pública
    expect(JSON.stringify(corpo)).not.toContain('unitCost');

    // pedir de novo devolve o MESMO link: o cliente já salvou o que tem
    const denovo = await post(`/api/v1/work-orders/${os.id}/tracking-link`);
    expect((denovo.json() as { publicUrl: string }).publicUrl).toBe(publicUrl);
  });

  it('token de acompanhamento inventado não abre nada', async () => {
    expect((await publico('/api/v1/public/tracking/naoexisteesselinkaqui00000')).statusCode).toBe(404);
  });

  it('o funil de outra oficina não aparece neste', async () => {
    const outra = await signup(t.app, { organizationName: 'Oficina Vizinha' });
    await post('/api/v1/leads', { name: 'Lead da vizinha' }, outra);
    const meu = (await get('/api/v1/leads')).json() as Funil;
    expect(meu.stages.flatMap((etapa) => etapa.leads).some((lead) => lead.name === 'Lead da vizinha')).toBe(false);
  });
});
