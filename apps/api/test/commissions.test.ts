import { randomUUID } from 'node:crypto';
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

interface Relatorio {
  from: string;
  to: string;
  configured: boolean;
  mechanics: {
    mechanicUserId: string;
    mechanicName: string;
    laborCents: number;
    fullCommissionCents: number;
    earnedCents: number;
    paidOutCents: number;
    orders: { number: number; dueCents: number; paidCents: number; fullCommissionCents: number; earnedCents: number }[];
  }[];
  totals: { fullCommissionCents: number; earnedCents: number; paidOutCents: number };
}

/**
 * Comissão do mecânico (E26).
 *
 * O que precisa ficar provado: qual percentual vence (serviço > mecânico >
 * oficina), que peça não entra na conta, que a comissão só é ganha conforme o
 * cliente paga, que o percentual fica **congelado** quando a OS é finalizada,
 * e que o mecânico enxerga a dele e só a dele.
 */
describe('comissão do mecânico', () => {
  let t: TestApp;
  let dono: TestSession;
  let mecanico: TestSession;
  let outro: TestSession;
  let servicoComum: string;
  let servicoEspecial: string;
  let peca: string;
  let sequencia = 0;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const patch = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  /**
   * O dia NA OFICINA, não em UTC. O relatório usa o fuso da oficina; depois das
   * 21h, `toISOString()` já devolve amanhã e o fechamento caía fora do período
   * — o teste passava de manhã e reprovava à noite.
   */
  const hojeNaOficina = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  const relatorio = async (s: TestSession = dono): Promise<Relatorio> =>
    (await get('/api/v1/commissions', s)).json() as Relatorio;

  /**
   * Uma OS aprovada, finalizada e com o mecânico como responsável — é assim
   * que a comissão nasce. Devolve o número e o total.
   */
  async function osFinalizada(opcoes: { servicoId: string; comPeca?: boolean; mecanico?: TestSession } = { servicoId: '' }) {
    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira' });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: `CMS${1000 + sequencia++}` });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: veiculo.id,
      mechanicUserId: (opcoes.mecanico ?? mecanico).userId,
      items: [
        { type: 'SERVICE', serviceId: opcoes.servicoId },
        ...(opcoes.comPeca ? [{ type: 'PART' as const, partId: peca, quantity: 2 }] : []),
      ],
    });
    const orcamento = (await post(`/api/v1/work-orders/${os.id}/quotes`, {})).json() as { id: string };
    await post(`/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await post(`/api/v1/work-orders/${os.id}/start`);
    await post(`/api/v1/work-orders/${os.id}/complete`);
    return os;
  }

  const receber = (osId: string, amountCents: number) =>
    post(`/api/v1/work-orders/${osId}/payments`, {
      clientRequestId: randomUUID(),
      method: 'PIX',
      amountCents,
    });

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    outro = await addMember(t.app, dono, 'MECHANIC', 'Ana Mecânica');
    servicoComum = ((await post('/api/v1/services', { name: 'Troca de óleo', priceCents: 20_000 })).json() as { id: string }).id;
    servicoEspecial = (
      (await post('/api/v1/services', { name: 'Retífica de motor', priceCents: 100_000, commissionBps: 1500 })).json() as {
        id: string;
      }
    ).id;
    peca = (
      (await post('/api/v1/parts', { name: 'Filtro de óleo', salePriceCents: 5_000, initialQuantity: 10 })).json() as {
        id: string;
      }
    ).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('sem percentual configurado, ninguém ganha comissão — e a tela sabe disso', async () => {
    await osFinalizada({ servicoId: servicoComum });
    const semConfigurar = await relatorio();
    expect(semConfigurar.mechanics, 'oficina que não paga comissão tem relatório vazio').toEqual([]);
    expect(semConfigurar.configured, 'a tela explica em vez de mostrar zero').toBe(false);
  });

  it('o percentual da oficina vale para quem não tem o seu', async () => {
    expect((await patch('/api/v1/organization/settings', { commissionBps: 1000 })).statusCode).toBe(200);

    const os = await osFinalizada({ servicoId: servicoComum });
    const dados = await relatorio();
    const linha = dados.mechanics.find((m) => m.mechanicUserId === mecanico.userId)!;
    const ordem = linha.orders.find((o) => o.number === os.number)!;

    expect(ordem.fullCommissionCents, '10% de R$ 200').toBe(2000);
    expect(ordem.earnedCents, 'o cliente ainda não pagou nada').toBe(0);
    expect(dados.configured).toBe(true);
  });

  it('a comissão é ganha conforme o cliente paga', async () => {
    const os = await osFinalizada({ servicoId: servicoComum });
    await receber(os.id, 10_000); // metade dos R$ 200

    const linha = (await relatorio()).mechanics.find((m) => m.mechanicUserId === mecanico.userId)!;
    const ordem = linha.orders.find((o) => o.number === os.number)!;
    expect(ordem.paidCents).toBe(10_000);
    expect(ordem.fullCommissionCents).toBe(2000);
    expect(ordem.earnedCents, 'metade paga, metade da comissão').toBe(1000);

    await receber(os.id, 10_000);
    const depois = (await relatorio()).mechanics.find((m) => m.mechanicUserId === mecanico.userId)!;
    expect(depois.orders.find((o) => o.number === os.number)!.earnedCents, 'quitada, comissão inteira').toBe(2000);
  });

  it('peça não entra na comissão: quem assume o risco dela é a oficina', async () => {
    const os = await osFinalizada({ servicoId: servicoComum, comPeca: true });
    await receber(os.id, 30_000); // R$ 200 de serviço + R$ 100 de peça

    const ordem = (await relatorio()).mechanics
      .find((m) => m.mechanicUserId === mecanico.userId)!
      .orders.find((o) => o.number === os.number)!;
    expect(ordem.dueCents, 'a OS cobra serviço e peça').toBe(30_000);
    expect(ordem.fullCommissionCents, 'mas a comissão é só sobre os R$ 200 de mão de obra').toBe(2000);
  });

  it('o percentual do mecânico ganha do da oficina, e o do serviço ganha dos dois', async () => {
    const membros = (await get('/api/v1/members')).json() as { data: { id: string; userId: string }[] };
    const membro = membros.data.find((m) => m.userId === mecanico.userId)!;
    expect((await patch(`/api/v1/members/${membro.id}`, { commissionBps: 1200 })).statusCode).toBe(200);

    const comum = await osFinalizada({ servicoId: servicoComum });
    const especial = await osFinalizada({ servicoId: servicoEspecial });

    const linha = (await relatorio()).mechanics.find((m) => m.mechanicUserId === mecanico.userId)!;
    expect(linha.orders.find((o) => o.number === comum.number)!.fullCommissionCents, '12% de R$ 200').toBe(2400);
    expect(
      linha.orders.find((o) => o.number === especial.number)!.fullCommissionCents,
      'o serviço manda: 15% de R$ 1.000',
    ).toBe(15_000);
  });

  it('mudar a tabela hoje não mexe no que já foi finalizado', async () => {
    const os = await osFinalizada({ servicoId: servicoComum });
    const antes = (await relatorio()).mechanics
      .find((m) => m.mechanicUserId === mecanico.userId)!
      .orders.find((o) => o.number === os.number)!.fullCommissionCents;

    await patch('/api/v1/organization/settings', { commissionBps: 5000 });
    const membros = (await get('/api/v1/members')).json() as { data: { id: string; userId: string }[] };
    const membro = membros.data.find((m) => m.userId === mecanico.userId)!;
    await patch(`/api/v1/members/${membro.id}`, { commissionBps: 4000 });

    const depois = (await relatorio()).mechanics
      .find((m) => m.mechanicUserId === mecanico.userId)!
      .orders.find((o) => o.number === os.number)!.fullCommissionCents;
    expect(depois, 'o percentual ficou congelado na OS').toBe(antes);

    // e a OS nova já nasce com a tabela nova
    const nova = await osFinalizada({ servicoId: servicoComum });
    const comissaoNova = (await relatorio()).mechanics
      .find((m) => m.mechanicUserId === mecanico.userId)!
      .orders.find((o) => o.number === nova.number)!.fullCommissionCents;
    expect(comissaoNova, '40% de R$ 200').toBe(8000);
  });

  it('o mecânico vê a dele, e só a dele', async () => {
    await osFinalizada({ servicoId: servicoComum, mecanico: outro });

    const daOficina = await relatorio();
    expect(daOficina.mechanics.length, 'quem administra vê os dois').toBeGreaterThan(1);

    const dele = await relatorio(mecanico);
    expect(dele.mechanics.every((m) => m.mechanicUserId === mecanico.userId), 'nada do colega').toBe(true);
  });

  it('o fechamento vira registro, e aparece no que ainda falta pagar', async () => {
    const antes = (await relatorio()).mechanics.find((m) => m.mechanicUserId === mecanico.userId)!;
    const hoje = hojeNaOficina();

    const pago = await post('/api/v1/commissions/payouts', {
      mechanicUserId: mecanico.userId,
      periodFrom: hoje,
      periodTo: hoje,
      amountCents: 1500,
      notes: 'Adiantamento',
    });
    expect(pago.statusCode, pago.body).toBe(201);

    const depois = (await relatorio()).mechanics.find((m) => m.mechanicUserId === mecanico.userId)!;
    expect(depois.earnedCents, 'o que ele ganhou não muda por ter recebido').toBe(antes.earnedCents);
    expect(depois.paidOutCents, 'e o que já foi pago aparece do lado').toBe(1500);

    const lista = (await get('/api/v1/commissions/payouts')).json() as { data: { amountCents: number }[] };
    expect(lista.data[0]!.amountCents).toBe(1500);
  });

  it('mecânico não registra o próprio pagamento', async () => {
    const hoje = hojeNaOficina();
    const res = await post(
      '/api/v1/commissions/payouts',
      { mechanicUserId: mecanico.userId, periodFrom: hoje, periodTo: hoje, amountCents: 5000 },
      mecanico,
    );
    expect(res.statusCode).toBe(403);
  });

  it('o período aceita os atalhos do financeiro, no dia da oficina', async () => {
    const os = await osFinalizada({ servicoId: servicoComum });
    const hoje = hojeNaOficina();
    const comAtalho = async (consulta: string) =>
      (await get(`/api/v1/commissions?${consulta}`)).json() as Relatorio;
    const temAOs = (dados: Relatorio) =>
      dados.mechanics.some((m) => m.orders.some((o) => o.number === os.number));

    const doDia = await comAtalho('period=today');
    expect([doDia.from, doDia.to], '"hoje" é o dia da oficina').toEqual([hoje, hoje]);
    expect(temAOs(doDia), 'a OS finalizada hoje entra em "hoje"').toBe(true);

    const seteDias = await comAtalho('period=last7');
    const seisDiasAtras = new Date(`${hoje}T12:00:00Z`);
    seisDiasAtras.setUTCDate(seisDiasAtras.getUTCDate() - 6);
    expect(seteDias.from, '"últimos 7 dias" conta hoje').toBe(seisDiasAtras.toISOString().slice(0, 10));
    expect(seteDias.to).toBe(hoje);

    const datasMandam = await comAtalho('period=today&from=2020-01-01&to=2020-01-31');
    expect([datasMandam.from, datasMandam.to], 'data digitada vence o atalho').toEqual(['2020-01-01', '2020-01-31']);
    expect(temAOs(datasMandam), 'janeiro de 2020 não tem a OS de hoje').toBe(false);
  });
});
