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

interface TestAppointment {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  mechanicUserId: string | null;
  mechanicName: string | null;
  vehicleId: string | null;
  workOrderId: string | null;
  workOrderNumber: number | null;
  cancelReason: string | null;
  title: string;
}

/** 14/09/2026 é uma segunda-feira. 12:00Z = 09:00 no relógio de São Paulo. */
const dia = (hora: string) => `2026-09-14T${hora}:00.000Z`;

/**
 * Agenda (E8). O que precisa ficar provado aqui é o que o critério da etapa
 * pede: conflito detectado em **sobreposição parcial** — avisando, não
 * travando — e o **fuso da oficina** respeitado em tudo que a API escreve.
 */
describe('agenda', () => {
  let t: TestApp;
  let owner: TestSession;
  let joao: TestSession;
  let maria: TestSession;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    joao = await addMember(t.app, owner, 'MECHANIC', 'João Mecânico');
    maria = await addMember(t.app, owner, 'MECHANIC', 'Maria Mecânica');
    const customer = await createCustomer(t.app, owner, { name: 'Carlos Cliente' });
    customerId = customer.id;
    vehicleId = (await createVehicle(t.app, owner, customerId, { plate: 'AGE1A23' })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const post = (url: string, payload: Record<string, unknown> = {}, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });
  const patch = (url: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload });
  const get = (url: string, s: TestSession = owner) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  /** Agendamento das `de` às `ate` (em UTC), do mecânico dado. */
  async function agendar(
    de: string,
    ate: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ status: number; body: TestAppointment; raw: string }> {
    const res = await post('/api/v1/appointments', {
      customerId,
      vehicleId,
      title: 'Revisão dos 10.000 km',
      startsAt: dia(de),
      endsAt: dia(ate),
      ...extra,
    });
    return { status: res.statusCode, body: res.json() as TestAppointment, raw: res.body };
  }

  it('marca o horário e ele aparece na janela da agenda', async () => {
    const criado = await agendar('12:00', '13:00', { mechanicUserId: joao.userId });
    expect(criado.status, criado.raw).toBe(201);
    expect(criado.body.status).toBe('SCHEDULED');
    expect(criado.body.mechanicName).toBe('João Mecânico');

    // a janela é o dia 14/09 no relógio de São Paulo: 03:00Z de um dia ao outro
    const lista = await get('/api/v1/appointments?from=2026-09-14T03:00:00Z&to=2026-09-15T03:00:00Z');
    expect(lista.statusCode, lista.body).toBe(200);
    const ids = (lista.json().data as TestAppointment[]).map((a) => a.id);
    expect(ids).toContain(criado.body.id);
  });

  it('avisa do conflito em sobreposição parcial e deixa encaixar com force', async () => {
    // 09:00–10:00 já é do João (teste anterior); agora tentam 09:30–10:30
    const conflitante = await agendar('12:30', '13:30', { mechanicUserId: joao.userId });
    expect(conflitante.status, conflitante.raw).toBe(422);
    const problema = conflitante.body as unknown as { code: string; errors: { message: string }[] };
    expect(problema.code).toBe('APPOINTMENT_CONFLICT');
    // a mensagem diz quem, o quê e a que horas — no relógio da oficina
    expect(problema.errors[0]!.message).toContain('João Mecânico');
    expect(problema.errors[0]!.message).toContain('das 09:00 às 10:00');

    const encaixe = await agendar('12:30', '13:30', { mechanicUserId: joao.userId, force: true });
    expect(encaixe.status, encaixe.raw).toBe(201);
  });

  it('encostar não é conflito, e mecânico diferente trabalha ao mesmo tempo', async () => {
    const encostado = await agendar('13:30', '14:30', { mechanicUserId: joao.userId });
    expect(encostado.status, encostado.raw).toBe(201);

    const outra = await agendar('12:00', '13:00', { mechanicUserId: maria.userId });
    expect(outra.status, outra.raw).toBe(201);
  });

  it('agendamento sem mecânico não disputa a hora de ninguém', async () => {
    const semMecanico = await agendar('12:00', '13:00');
    expect(semMecanico.status, semMecanico.raw).toBe(201);
    expect(semMecanico.body.mechanicUserId).toBeNull();
  });

  it('cancelar devolve o horário para a agenda', async () => {
    const criado = await agendar('16:00', '17:00', { mechanicUserId: joao.userId });
    expect(criado.status, criado.raw).toBe(201);

    const semMotivo = await post(`/api/v1/appointments/${criado.body.id}/cancel`, {});
    expect(semMotivo.statusCode, semMotivo.body).toBe(400);

    const cancelado = await post(`/api/v1/appointments/${criado.body.id}/cancel`, { reason: 'Cliente remarcou' });
    expect(cancelado.statusCode, cancelado.body).toBe(200);
    expect(cancelado.json().status).toBe('CANCELED');
    expect(cancelado.json().cancelReason).toBe('Cliente remarcou');

    // mesma hora, mesmo mecânico, sem force: o horário voltou a ficar livre
    const novo = await agendar('16:00', '17:00', { mechanicUserId: joao.userId });
    expect(novo.status, novo.raw).toBe(201);
  });

  it('ao remarcar, o agendamento não conflita consigo mesmo', async () => {
    const criado = await agendar('18:00', '19:00', { mechanicUserId: maria.userId });
    expect(criado.status, criado.raw).toBe(201);

    // arrastou meia hora para a frente: a sobreposição é com ele mesmo
    const movido = await patch(`/api/v1/appointments/${criado.body.id}`, {
      startsAt: dia('18:30'),
      endsAt: dia('19:30'),
    });
    expect(movido.statusCode, movido.body).toBe(200);
    expect(movido.json().startsAt).toBe(dia('18:30'));

    // agora sim, por cima de outro compromisso da Maria
    const vizinho = await agendar('20:00', '21:00', { mechanicUserId: maria.userId });
    expect(vizinho.status, vizinho.raw).toBe(201);
    const porCima = await patch(`/api/v1/appointments/${criado.body.id}`, {
      startsAt: dia('20:30'),
      endsAt: dia('21:30'),
    });
    expect(porCima.statusCode, porCima.body).toBe(422);
    expect(porCima.json().code).toBe('APPOINTMENT_CONFLICT');

    const forcado = await patch(`/api/v1/appointments/${criado.body.id}`, {
      startsAt: dia('20:30'),
      endsAt: dia('21:30'),
      force: true,
    });
    expect(forcado.statusCode, forcado.body).toBe(200);
  });

  it('a conferência de conflito responde antes de gravar', async () => {
    const livre = await get(
      `/api/v1/appointments/conflicts?mechanicId=${joao.userId}&startsAt=${dia('05:00')}&endsAt=${dia('06:00')}`,
    );
    expect(livre.statusCode, livre.body).toBe(200);
    expect(livre.json().data).toEqual([]);

    const ocupado = await get(
      `/api/v1/appointments/conflicts?mechanicId=${joao.userId}&startsAt=${dia('12:15')}&endsAt=${dia('12:45')}`,
    );
    expect(ocupado.json().data.length).toBeGreaterThan(0);
  });

  it('o check-in cria a OS, liga os dois lados e não acontece duas vezes', async () => {
    const criado = await agendar('22:00', '23:00', { mechanicUserId: joao.userId });
    expect(criado.status, criado.raw).toBe(201);

    const checkIn = await post(`/api/v1/appointments/${criado.body.id}/check-in`, { odometerKm: 48000 });
    expect(checkIn.statusCode, checkIn.body).toBe(201);
    const os = checkIn.json();
    expect(os.number).toBeGreaterThan(0);
    expect(os.status).toBe('OPEN');
    expect(os.odometerKm).toBe(48000);

    const depois = await get(`/api/v1/appointments/${criado.body.id}`);
    expect(depois.json().status).toBe('IN_PROGRESS');
    expect(depois.json().workOrderId).toBe(os.id);
    expect(depois.json().workOrderNumber).toBe(os.number);

    // a OS diz de onde veio, na linha do tempo que a oficina lê
    const timeline = await get(`/api/v1/work-orders/${os.id}/timeline`);
    const textos = (timeline.json().data as { data: { text?: string } }[]).map((e) => e.data.text ?? '');
    expect(textos.some((texto) => texto.includes('agendamento'))).toBe(true);

    const repetido = await post(`/api/v1/appointments/${criado.body.id}/check-in`, {});
    expect(repetido.statusCode, repetido.body).toBe(409);
    expect(repetido.json().code).toBe('APPOINTMENT_ALREADY_CHECKED_IN');
  });

  it('check-in de agendamento sem veículo pede o veículo', async () => {
    const semCarro = await agendar('05:00', '06:00', { vehicleId: null, mechanicUserId: maria.userId });
    expect(semCarro.status, semCarro.raw).toBe(201);

    const semEscolher = await post(`/api/v1/appointments/${semCarro.body.id}/check-in`, {});
    expect(semEscolher.statusCode, semEscolher.body).toBe(400);
    expect(semEscolher.json().errors[0].path).toBe('body.vehicleId');

    const escolhendo = await post(`/api/v1/appointments/${semCarro.body.id}/check-in`, { vehicleId });
    expect(escolhendo.statusCode, escolhendo.body).toBe(201);
  });

  it('agendamento encerrado não volta: nem check-in, nem remarcação', async () => {
    const criado = await agendar('07:00', '08:00', { mechanicUserId: joao.userId });
    const faltou = await post(`/api/v1/appointments/${criado.body.id}/no-show`);
    expect(faltou.statusCode, faltou.body).toBe(200);
    expect(faltou.json().status).toBe('NO_SHOW');

    const checkIn = await post(`/api/v1/appointments/${criado.body.id}/check-in`, {});
    expect(checkIn.statusCode, checkIn.body).toBe(422);
    expect(checkIn.json().code).toBe('INVALID_TRANSITION');

    const remarcar = await patch(`/api/v1/appointments/${criado.body.id}`, {
      startsAt: dia('09:00'),
      endsAt: dia('10:00'),
    });
    expect(remarcar.statusCode, remarcar.body).toBe(422);
  });

  it('confirma a presença e registra quando', async () => {
    const criado = await agendar('01:00', '02:00', { mechanicUserId: maria.userId });
    const confirmado = await post(`/api/v1/appointments/${criado.body.id}/confirm`);
    expect(confirmado.statusCode, confirmado.body).toBe(200);
    expect(confirmado.json().status).toBe('CONFIRMED');
    expect(confirmado.json().confirmedAt).not.toBeNull();

    const denovo = await post(`/api/v1/appointments/${criado.body.id}/confirm`);
    expect(denovo.statusCode, denovo.body).toBe(422);
  });

  it('recusa veículo de outro cliente e mecânico de fora da equipe', async () => {
    const outroCliente = await createCustomer(t.app, owner, { name: 'Outra Pessoa' });
    const outroCarro = await createVehicle(t.app, owner, outroCliente.id, { plate: 'AGE9Z99' });

    const trocado = await agendar('03:00', '04:00', { vehicleId: outroCarro.id });
    expect(trocado.status, trocado.raw).toBe(400);
    expect(trocado.body as unknown as { errors: { path: string }[] }).toMatchObject({
      errors: [{ path: 'body.vehicleId' }],
    });

    const deFora = await signup(t.app);
    const estranho = await agendar('03:00', '04:00', { mechanicUserId: deFora.userId });
    expect(estranho.status, estranho.raw).toBe(400);
  });

  it('oficina de fora não enxerga o agendamento: 404, nunca 403', async () => {
    const criado = await agendar('04:00', '05:00', { mechanicUserId: joao.userId });
    const vizinha = await signup(t.app);

    const lendo = await get(`/api/v1/appointments/${criado.body.id}`, vizinha);
    expect(lendo.statusCode, lendo.body).toBe(404);

    const mexendo = await patch(
      `/api/v1/appointments/${criado.body.id}`,
      { startsAt: dia('06:00'), endsAt: dia('07:00') },
      vizinha,
    );
    expect(mexendo.statusCode, mexendo.body).toBe(404);

    const lista = await get('/api/v1/appointments?from=2026-09-14T03:00:00Z&to=2026-09-15T03:00:00Z', vizinha);
    expect(lista.json().data).toEqual([]);
  });

  /**
   * O critério da etapa: **o fuso da oficina é respeitado**. O mesmo instante
   * (12:00Z) é 09:00 em São Paulo e 08:00 em Manaus, e é a oficina que manda —
   * não o servidor, que nos testes roda em outro fuso qualquer.
   */
  it('escreve os horários no relógio da oficina, não no do servidor', async () => {
    const mudou = await patch('/api/v1/organization', { timezone: 'America/Manaus' });
    expect(mudou.statusCode, mudou.body).toBe(200);

    const base = await agendar('12:00', '13:00', { mechanicUserId: maria.userId, force: true });
    expect(base.status, base.raw).toBe(201);

    const conflito = await agendar('12:30', '13:30', { mechanicUserId: maria.userId });
    expect(conflito.status, conflito.raw).toBe(422);
    const problema = conflito.body as unknown as { errors: { message: string }[] };
    expect(problema.errors.some((e) => e.message.includes('das 08:00 às 09:00'))).toBe(true);
    expect(problema.errors.some((e) => e.message.includes('das 09:00 às 10:00'))).toBe(false);
  });
  it('monta a confirmação pelo WhatsApp com a hora da oficina', async () => {
    const criado = await agendar('12:00', '13:00', { mechanicUserId: joao.userId, force: true });
    expect(criado.status, criado.raw).toBe(201);

    const confirmacao = await post(`/api/v1/appointments/${criado.body.id}/confirmation`);
    expect(confirmacao.statusCode, confirmacao.body).toBe(200);
    const { message, whatsappUrl } = confirmacao.json() as { message: string; whatsappUrl: string | null };
    // a oficina está em Manaus neste ponto do teste: 12:00Z é 08:00 lá
    expect(message).toContain('segunda, 14/09, às 08:00');
    expect(message).toContain('Revisão dos 10.000 km');
    // cliente sem WhatsApp cadastrado: a mensagem existe, o link não
    expect(whatsappUrl).toBeNull();
  });
});
