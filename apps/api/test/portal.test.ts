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

/**
 * App do cliente (E50).
 *
 * O que precisa ficar provado: o link abre sem login e mostra SÓ o que é
 * daquele cliente (carros, OS em andamento, orçamento esperando resposta,
 * histórico com os serviços); mandar de novo troca o link; o mecânico, que
 * não vê o contato do cliente, não manda link; e o "pôr na tela inicial" abre
 * no link do próprio cliente.
 */
describe('app do cliente', () => {
  let t: TestApp;
  let dono: TestSession;
  let clienteId: string;
  let outroClienteId: string;
  let servicoId: string;
  let token: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const publico = (tk: string, extra = '') => t.app.inject({ method: 'GET', url: `/api/v1/public/portal/${tk}${extra}` });
  const tokenDe = (url: string) => url.split('/cliente/')[1]!;

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    servicoId = ((await post('/api/v1/services', { name: 'Troca de óleo', priceCents: 15_000 })).json() as { id: string }).id;
    clienteId = (await createCustomer(t.app, dono, { name: 'Paula Moreira', whatsapp: '(35) 99888-1122' })).id;
    outroClienteId = (await createCustomer(t.app, dono, { name: 'Outro Cliente' })).id;

    // uma OS entregue (histórico) e uma em andamento com orçamento enviado
    const carro = await createVehicle(t.app, dono, clienteId, { plate: 'POR1A23', make: 'Honda', model: 'Fit' });
    const entregue = await createWorkOrder(t.app, dono, { customerId: clienteId, vehicleId: carro.id, items: [{ type: 'SERVICE', serviceId: servicoId }] });
    const orcamento = (await post(`/api/v1/work-orders/${entregue.id}/quotes`, {})).json() as { id: string };
    await post(`/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await post(`/api/v1/work-orders/${entregue.id}/start`);
    await post(`/api/v1/work-orders/${entregue.id}/complete`);
    await post(`/api/v1/work-orders/${entregue.id}/payments`, { method: 'PIX', amountCents: 15_000 });
    expect((await post(`/api/v1/work-orders/${entregue.id}/deliver`)).statusCode).toBe(200);

    const aberta = await createWorkOrder(t.app, dono, { customerId: clienteId, vehicleId: carro.id, items: [{ type: 'SERVICE', serviceId: servicoId }] });
    expect((await post(`/api/v1/work-orders/${aberta.id}/quotes`, {})).statusCode).toBe(201);

    // a OS de outro cliente não pode aparecer
    const carroDoOutro = await createVehicle(t.app, dono, outroClienteId, { plate: 'OUT9Z99', make: 'Fiat', model: 'Uno' });
    await createWorkOrder(t.app, dono, { customerId: outroClienteId, vehicleId: carroDoOutro.id, items: [] });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('a oficina manda o link pelo WhatsApp', async () => {
    const res = await post(`/api/v1/customers/${clienteId}/portal-link`);
    expect(res.statusCode, res.body).toBe(201);
    const { publicUrl, message, whatsappUrl } = res.json();
    expect(message).toContain('Olá, Paula!');
    expect(whatsappUrl).toContain('wa.me/');
    token = tokenDe(publicUrl);
  });

  it('o link abre sem login e mostra só o que é dela', async () => {
    const res = await publico(token);
    expect(res.statusCode, res.body).toBe(200);
    const vista = res.json();
    expect(vista.customerFirstName).toBe('Paula');
    expect(vista.vehicles.map((v: { label: string }) => v.label)).toEqual(['Honda Fit']);
    expect(vista.history).toHaveLength(1);
    expect(vista.history[0].services).toEqual(['Troca de óleo']);
    expect(vista.history[0].totalCents).toBe(15_000);
    expect(vista.current).toHaveLength(1);
    expect(vista.current[0].status).toBe('AWAITING_APPROVAL');
    expect(vista.quotes).toHaveLength(1);
    expect(vista.quotes[0].url).toContain('/orcamento/');
    expect(JSON.stringify(vista), 'nada do outro cliente').not.toContain('Uno');
  });

  it('o "pôr na tela inicial" abre no link dela', async () => {
    const res = await publico(token, '/manifest.webmanifest');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('manifest+json');
    expect(res.json().start_url).toBe(`/cliente/${token}`);
  });

  it('mandar de novo troca o link: o antigo para de abrir', async () => {
    const novo = tokenDe((await post(`/api/v1/customers/${clienteId}/portal-link`)).json().publicUrl);
    expect((await publico(token)).statusCode).toBe(404);
    expect((await publico(novo)).statusCode).toBe(200);
  });

  it('o mecânico não manda link (não vê o contato do cliente); outra oficina não acha o cliente', async () => {
    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé');
    expect((await post(`/api/v1/customers/${clienteId}/portal-link`, {}, mecanico)).statusCode).toBe(403);
    const outra = await signup(t.app);
    expect((await post(`/api/v1/customers/${clienteId}/portal-link`, {}, outra)).statusCode).toBe(404);
  });

  it('token inventado não abre nada', async () => {
    expect((await publico('x'.repeat(43))).statusCode).toBe(404);
  });
});
