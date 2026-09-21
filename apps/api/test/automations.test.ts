import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTOMATION_DEFAULTS } from '@oficinaos/shared';
import { withTenant } from '../src/db/tenant';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

interface Visao {
  settings: {
    followUpQueue: boolean;
    appointmentReminder: boolean;
    quoteNoAnswer: boolean;
    dailyDigest: boolean;
    runHour: number;
    quoteNoAnswerDays: number;
    digestEmail: string | null;
    workerEnabled: boolean;
  };
  runs: { key: string; created: number; error: string | null; ranAt: string }[];
}

interface Aviso {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
}

/**
 * Automações (V3, E21).
 *
 * O que precisa ficar provado: cada automação faz o que promete e **só o que
 * promete** (nenhuma manda mensagem para o cliente), rodar duas vezes não
 * duplica nada, dia sem pendência não vira e-mail, e toda execução deixa
 * registro — inclusive quando dá erro.
 */
describe('automações', () => {
  let t: TestApp;
  let dono: TestSession;
  let gerente: TestSession;
  let servicoId: string;
  const { db } = testDb();
  let sequencia = 0;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const put = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'PUT', url, headers: bearer(s.accessToken), payload: payload as never });

  const rodar = (key: string) => post('/api/v1/automations/run', { key });
  const visao = async () => (await get('/api/v1/automations')).json() as Visao;
  const avisos = async (s: TestSession = dono) =>
    ((await get('/api/v1/notifications', s)).json() as { data: Aviso[] }).data;

  const orgId = async () =>
    ((await get('/api/v1/auth/me')).json() as { organization: { id: string } }).organization.id;

  /** O que só o tempo faria: envelhecer um registro. Com contexto de RLS. */
  const envelhecer = async (patch: string) =>
    withTenant(db, { organizationId: await orgId() }, (tx) => tx.execute(sql.raw(patch)));

  async function osEntregue(): Promise<{ workOrderId: string; number: number; customerId: string }> {
    const cliente = await createCustomer(t.app, dono, { name: `Cliente ${sequencia}` });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: `AUT${sequencia++}A23`.slice(0, 7) });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: veiculo.id,
      items: [{ type: 'SERVICE', serviceId: servicoId }],
    });
    const orcamento = await post(`/api/v1/work-orders/${os.id}/quotes`, {});
    await post(`/api/v1/quotes/${(orcamento.json() as { id: string }).id}/manual-decision`, {
      decision: 'APPROVED',
      channel: 'PHONE',
    });
    await post(`/api/v1/work-orders/${os.id}/start`);
    await post(`/api/v1/work-orders/${os.id}/complete`);
    await post(`/api/v1/work-orders/${os.id}/deliver`);
    return { workOrderId: os.id, number: os.number, customerId: cliente.id };
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    gerente = await addMember(t.app, dono, 'MANAGER', 'Marta Gerente');
    servicoId = ((await post('/api/v1/services', { name: 'Revisão', priceCents: 20_000 })).json() as { id: string }).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ---------------------------- configuração -----------------------------

  it('sem configurar nada, valem os padrões — e o e-mail do dia vem desligado', async () => {
    const dados = await visao();
    expect(dados.settings.followUpQueue).toBe(AUTOMATION_DEFAULTS.followUpQueue);
    expect(dados.settings.dailyDigest, 'e-mail que ninguém pediu é spam').toBe(false);
    expect(dados.settings.runHour).toBe(AUTOMATION_DEFAULTS.runHour);
    expect(dados.settings.workerEnabled, 'em teste o trabalhador não sobe').toBe(false);
    expect(dados.runs).toEqual([]);
  });

  it('a oficina escolhe o que roda, a hora e o prazo — dentro do que faz sentido', async () => {
    const res = await put('/api/v1/automations', { runHour: 7, quoteNoAnswerDays: 5, dailyDigest: true });
    expect(res.statusCode, res.body).toBe(200);
    const dados = res.json() as Visao;
    expect(dados.settings.runHour).toBe(7);
    expect(dados.settings.quoteNoAnswerDays).toBe(5);
    expect(dados.settings.dailyDigest).toBe(true);

    expect((await put('/api/v1/automations', { runHour: 25 })).statusCode, 'não existe hora 25').toBe(400);
    expect((await put('/api/v1/automations', { quoteNoAnswerDays: 0 })).statusCode).toBe(400);
  });

  it('automação é configuração da oficina: o gerente não mexe', async () => {
    expect((await get('/api/v1/automations', gerente)).statusCode).toBe(403);
    expect((await post('/api/v1/automations/run', { key: 'FOLLOW_UP_QUEUE' }, gerente)).statusCode).toBe(403);
  });

  // --------------------------- fila de pós-venda ---------------------------

  it('a fila do dia nasce pronta, avisa no sino, e rodar de novo não duplica', async () => {
    const os = await osEntregue();
    // entregue há 8 dias: é quando o pós-venda entra na fila
    await envelhecer(
      `update work_orders set delivered_at = now() - interval '8 days' where id = '${os.workOrderId}'`,
    );

    const res = await rodar('FOLLOW_UP_QUEUE');
    expect(res.statusCode, res.body).toBe(200);
    const execucao = (res.json() as Visao).runs.find((run) => run.key === 'FOLLOW_UP_QUEUE')!;
    expect(execucao.created, 'um contato criado e o aviso no sino').toBeGreaterThan(0);
    expect(execucao.error).toBeNull();

    const fila = (await get('/api/v1/follow-ups?filter=all')).json() as { data: { workOrderId: string | null }[] };
    expect(fila.data.some((linha) => linha.workOrderId === os.workOrderId)).toBe(true);

    const sino = await avisos();
    expect(sino.some((aviso) => aviso.type === 'FOLLOW_UP_DUE')).toBe(true);

    // rodar de novo: a dedupe_key impede a mesma conversa duas vezes
    const antes = fila.data.length;
    await rodar('FOLLOW_UP_QUEUE');
    const depois = (await get('/api/v1/follow-ups?filter=all')).json() as { data: unknown[] };
    expect(depois.data.length, 'a fila não cresce à toa').toBe(antes);
  });

  // ------------------------ lembrete de agendamento ------------------------

  it('avisa dos agendamentos de amanhã que ninguém confirmou', async () => {
    const semNada = await rodar('APPOINTMENT_REMINDER');
    expect((semNada.json() as Visao).runs.find((run) => run.key === 'APPOINTMENT_REMINDER')!.created).toBe(0);

    const cliente = await createCustomer(t.app, dono, { name: 'Marcos Agendado' });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: 'AGD1A23' });
    const amanha = new Date(Date.now() + 26 * 60 * 60 * 1000);
    const criou = await post('/api/v1/appointments', {
      customerId: cliente.id,
      vehicleId: veiculo.id,
      title: 'Troca de óleo',
      startsAt: amanha.toISOString(),
      endsAt: new Date(amanha.getTime() + 3_600_000).toISOString(),
    });
    expect(criou.statusCode, criou.body).toBe(201);

    const res = await rodar('APPOINTMENT_REMINDER');
    expect((res.json() as Visao).runs.find((run) => run.key === 'APPOINTMENT_REMINDER')!.created).toBeGreaterThan(0);
    const aviso = (await avisos()).find((linha) => linha.type === 'APPOINTMENT_TOMORROW');
    expect(aviso, 'o sino avisa').toBeTruthy();
    expect(aviso!.title).toContain('amanhã');
    expect(aviso!.link).toBe('/agenda');
  });

  // ------------------------ orçamento sem resposta -------------------------

  it('avisa do orçamento enviado que ficou parado, e só dele', async () => {
    const cliente = await createCustomer(t.app, dono, { name: 'Paulo Parado' });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: 'ORC1A23' });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: veiculo.id,
      items: [{ type: 'SERVICE', serviceId: servicoId }],
    });
    const orcamento = (await post(`/api/v1/work-orders/${os.id}/quotes`, {})).json() as { id: string; number: number };

    // recém-enviado: ninguém precisa ser avisado ainda
    const cedo = await rodar('QUOTE_NO_ANSWER');
    expect((cedo.json() as Visao).runs.find((run) => run.key === 'QUOTE_NO_ANSWER')!.created).toBe(0);

    await envelhecer(`update quotes set sent_at = now() - interval '9 days' where id = '${orcamento.id}'`);
    const res = await rodar('QUOTE_NO_ANSWER');
    expect((res.json() as Visao).runs.find((run) => run.key === 'QUOTE_NO_ANSWER')!.created).toBeGreaterThan(0);

    const aviso = (await avisos()).find((linha) => linha.type === 'QUOTE_NO_ANSWER');
    expect(aviso).toBeTruthy();
    expect(aviso!.title).toContain(String(orcamento.number));
    expect(aviso!.body, 'diz se o cliente ao menos abriu o link').toContain('não abriu');
  });

  // ---------------------------- resumo do dia ------------------------------

  it('o resumo do dia sai por e-mail, com o que precisa de decisão', async () => {
    t.email.sent.length = 0;
    const res = await rodar('DAILY_DIGEST');
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Visao).runs.find((run) => run.key === 'DAILY_DIGEST')!.created).toBe(1);

    expect(t.email.sent).toHaveLength(1);
    const email = t.email.sent[0]!;
    expect(email.subject).toContain('OficinaOS');
    expect(email.text, 'o link do painel fecha o e-mail').toContain('http://localhost:5173');
    expect(email.text).toMatch(/contato|orçamento|agendamento|entrega|vencidos/);
  });

  it('oficina sem nada pendente não recebe e-mail nenhum', async () => {
    // oficina recém-criada: sem fila, sem agenda, sem orçamento parado
    const outra = await signup(t.app);
    t.email.sent.length = 0;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/automations/run',
      headers: bearer(outra.accessToken),
      payload: { key: 'DAILY_DIGEST' } as never,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Visao).runs.find((run) => run.key === 'DAILY_DIGEST')!.created).toBe(0);
    expect(t.email.sent, 'e-mail que não diz nada é spam').toHaveLength(0);
  });

  it('para onde o resumo vai é escolha da oficina', async () => {
    t.email.sent.length = 0;
    await put('/api/v1/automations', { digestEmail: 'financeiro@exemplo.invalido' });
    await rodar('DAILY_DIGEST');
    expect(t.email.sent[0]!.to).toBe('financeiro@exemplo.invalido');
  });

  // --------------------------- volta automática ----------------------------

  it('a volta do trabalhador respeita a hora da oficina e roda uma vez por dia', async () => {
    const organizationId = await orgId();
    // apaga o histórico de hoje e põe a hora para trás: a volta deve rodar
    await withTenant(db, { organizationId }, (tx) =>
      tx.execute(sql.raw(`delete from automation_runs where organization_id = '${organizationId}'`)),
    );
    await put('/api/v1/automations', { runHour: 0 });

    const primeira = await t.app.services.automations.tick(organizationId);
    expect(primeira.organizations, 'só a oficina deste teste').toBe(1);
    expect(primeira.ran, 'rodou as automações ligadas').toBeGreaterThan(0);

    const segunda = await t.app.services.automations.tick(organizationId);
    expect(segunda.ran, 'no mesmo dia, não roda de novo').toBe(0);
  });

  it('a hora escolhida é respeitada: antes dela, a volta não faz nada', async () => {
    const organizationId = await orgId();
    await withTenant(db, { organizationId }, (tx) =>
      tx.execute(sql.raw(`delete from automation_runs where organization_id = '${organizationId}'`)),
    );
    await put('/api/v1/automations', { runHour: 23 });

    const agora = new Date();
    const horaLocal = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(agora),
    );
    const resultado = await t.app.services.automations.tick(organizationId);
    // às 23h a conta muda; o teste só afirma o que vale fora dessa hora
    if (horaLocal < 23) expect(resultado.ran).toBe(0);
  });
});
