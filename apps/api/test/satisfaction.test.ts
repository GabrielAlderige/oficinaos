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

interface Pesquisa {
  shopName: string;
  customerFirstName: string;
  answered: boolean;
  score: number | null;
  googleReviewUrl: string | null;
}

/**
 * Pesquisa de satisfação (E49).
 *
 * O que precisa ficar provado: a pesquisa só sai depois da entrega; o link
 * abre sem login e aceita UMA resposta; a nota baixa avisa a oficina; o
 * convite do Google aparece para QUALQUER nota (nada de review gating); o NPS
 * soma certo; e o link de uma oficina não abre a pesquisa de outra.
 */
describe('pesquisa de satisfação', () => {
  let t: TestApp;
  let dono: TestSession;
  let atendente: TestSession;
  let clienteId: string;
  let servicoId: string;
  let sequencia = 0;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const publico = (method: 'GET' | 'POST', token: string, payload?: unknown) =>
    t.app.inject({ method, url: `/api/v1/public/surveys/${token}`, ...(payload ? { payload: payload as never } : {}) });
  const tokenDe = (url: string) => url.split('/pesquisa/')[1]!;

  async function osEntregue() {
    const carro = await createVehicle(t.app, dono, clienteId, { plate: `NPS${1000 + sequencia++}`, make: 'Fiat', model: 'Argo' });
    const os = await createWorkOrder(t.app, dono, { customerId: clienteId, vehicleId: carro.id, items: [{ type: 'SERVICE', serviceId: servicoId }] });
    const orcamento = (await post(`/api/v1/work-orders/${os.id}/quotes`, {})).json() as { id: string };
    await post(`/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await post(`/api/v1/work-orders/${os.id}/start`);
    await post(`/api/v1/work-orders/${os.id}/complete`);
    await post(`/api/v1/work-orders/${os.id}/payments`, { method: 'PIX', amountCents: 16_000 });
    expect((await post(`/api/v1/work-orders/${os.id}/deliver`)).statusCode).toBe(200);
    return os;
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Carla');
    clienteId = (await createCustomer(t.app, dono, { name: 'Roberto Alves', whatsapp: '(16) 99111-2233' })).id;
    servicoId = ((await post('/api/v1/services', { name: 'Alinhamento', priceCents: 16_000 })).json() as { id: string }).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('só depois da entrega, e o convite leva o link da pesquisa pelo WhatsApp', async () => {
    const carro = await createVehicle(t.app, dono, clienteId, { plate: 'NPS0001', make: 'VW', model: 'Gol' });
    const aberta = await createWorkOrder(t.app, dono, { customerId: clienteId, vehicleId: carro.id, items: [{ type: 'SERVICE', serviceId: servicoId }] });
    expect((await post(`/api/v1/work-orders/${aberta.id}/survey-invite`)).statusCode).toBe(422);

    const os = await osEntregue();
    const convite = await post(`/api/v1/work-orders/${os.id}/survey-invite`, {}, atendente);
    expect(convite.statusCode, convite.body).toBe(201);
    const { publicUrl, message, whatsappUrl } = convite.json();
    expect(publicUrl).toContain('/pesquisa/');
    expect(message).toContain('Olá, Roberto!');
    expect(whatsappUrl).toContain('wa.me/');

    const pagina = await publico('GET', tokenDe(publicUrl));
    expect(pagina.statusCode, pagina.body).toBe(200);
    const vista = pagina.json() as Pesquisa;
    expect(vista.customerFirstName).toBe('Roberto');
    expect(vista.answered).toBe(false);
  });

  it('nota baixa avisa a oficina, e o Google aparece mesmo assim (sem review gating)', async () => {
    await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/settings',
      headers: bearer(dono.accessToken),
      payload: { googleReviewUrl: 'https://g.page/r/oficina-nps' },
    });
    const os = await osEntregue();
    const token = tokenDe((await post(`/api/v1/work-orders/${os.id}/survey-invite`)).json().publicUrl);

    const resposta = await publico('POST', token, { score: 4, comment: 'Demorou dois dias a mais' });
    expect(resposta.statusCode, resposta.body).toBe(200);
    const depois = resposta.json() as Pesquisa;
    expect(depois.answered).toBe(true);
    expect(depois.googleReviewUrl, 'o convite do Google vale para qualquer nota').toBe('https://g.page/r/oficina-nps');

    const avisos = (await get('/api/v1/notifications')).json().data as { type: string; title: string; body: string }[];
    const aviso = avisos.find((n) => n.type === 'SATISFACTION_LOW');
    expect(aviso?.title).toContain('Nota 4');
    expect(aviso?.body).toContain('Demorou dois dias');

    const deNovo = await publico('POST', token, { score: 10 });
    expect(deNovo.statusCode, 'uma resposta por pesquisa').toBe(409);
  });

  it('mandar de novo troca o link: o antigo deixa de abrir', async () => {
    const os = await osEntregue();
    const antigo = tokenDe((await post(`/api/v1/work-orders/${os.id}/survey-invite`)).json().publicUrl);
    const novo = tokenDe((await post(`/api/v1/work-orders/${os.id}/survey-invite`)).json().publicUrl);
    expect((await publico('GET', antigo)).statusCode).toBe(404);
    expect((await publico('GET', novo)).statusCode).toBe(200);
  });

  // três OS completas (orçar, aprovar, executar, receber, entregar): com a suíte inteira rodando, passa dos 15 s
  it('o NPS soma promotores menos insatisfeitos', { timeout: 60_000 }, async () => {
    for (const nota of [10, 9, 8]) {
      const os = await osEntregue();
      const token = tokenDe((await post(`/api/v1/work-orders/${os.id}/survey-invite`)).json().publicUrl);
      expect((await publico('POST', token, { score: nota })).statusCode).toBe(200);
    }
    const resumo = (await get('/api/v1/satisfaction')).json();
    // 4 respostas: 10, 9 (promotores), 8 (neutro), 4 (insatisfeito) → 50% − 25% = 25
    expect(resumo.answered).toBe(4);
    expect(resumo.promoters).toBe(2);
    expect(resumo.detractors).toBe(1);
    expect(resumo.nps).toBe(25);
    expect(resumo.pending, 'convites sem resposta: o primeiro e o reenviado').toBe(2);
    expect(resumo.recent[0].customerName).toBe('Roberto Alves');
  });

  it('o mecânico não vê as notas; outra oficina não vê nada', async () => {
    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé');
    expect((await get('/api/v1/satisfaction', mecanico)).statusCode).toBe(403);
    const outra = await signup(t.app);
    expect((await get('/api/v1/satisfaction', outra)).json().answered).toBe(0);
  });

  it('token inventado não abre nada', async () => {
    expect((await publico('GET', 'x'.repeat(43))).statusCode).toBe(404);
  });
});
