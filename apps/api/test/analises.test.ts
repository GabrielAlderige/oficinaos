import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Analises } from '@oficinaos/shared';
import { withTenant } from '../src/db/tenant';
import {
  addMember,
  bearer,
  createCustomer,
  createPart,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

/**
 * Análises do financeiro (E51, fase 3), com o banco de verdade. Cenário feito
 * para dar conta redonda (comissão de 10%, mecânico Bruno em todas as OS):
 *
 * - há 1 mês: OS 1 da Maria, alinhamento R$ 200 (fica no período ANTERIOR);
 * - agora: OS 2 da Maria, revisão R$ 1.000 (cronometrada: 80 min, catálogo 60)
 *   + 1 filtro R$ 500; OS 3 do João, alinhamento R$ 200 (catálogo 30 min)
 *   + 2 filtros. Filtro custa R$ 300, havia 5.
 */
describe('Análises do financeiro', () => {
  let t: TestApp;
  let dono: TestSession;
  let mecanico: TestSession;
  let a: Analises;

  const req = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const naOficina = (q: ReturnType<typeof sql>) => withTenant(testDb().db, { organizationId: dono.orgId }, (tx) => tx.execute(q));

  async function finalizar(customerId: string, vehicleId: string, items: unknown[]) {
    const os = await createWorkOrder(t.app, dono, { customerId, vehicleId, mechanicUserId: mecanico.userId, items });
    const orcamento = (await post(`/api/v1/work-orders/${os.id}/quotes`)).json() as { id: string };
    await post(`/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await post(`/api/v1/work-orders/${os.id}/start`);
    return os;
  }
  const completar = async (os: { id: string }) => {
    const fim = await post(`/api/v1/work-orders/${os.id}/complete`);
    expect(fim.statusCode, fim.body).toBe(200);
  };

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Bruno');
    expect((await t.app.inject({ method: 'PATCH', url: '/api/v1/organization/settings', headers: bearer(dono.accessToken), payload: { commissionBps: 1000 } })).statusCode).toBe(200);

    const revisao = (await post('/api/v1/services', { name: 'Revisão', priceCents: 100_000, estimatedMinutes: 60 })).json().id as string;
    const alinhamento = (await post('/api/v1/services', { name: 'Alinhamento', priceCents: 20_000, estimatedMinutes: 30 })).json().id as string;
    const filtro = (await createPart(t.app, dono, { name: 'Filtro de óleo', salePriceCents: 50_000, initialQuantity: 5, initialUnitCostCents: 30_000 })).id;
    const maria = await createCustomer(t.app, dono, { name: 'Maria Souza' });
    const joao = await createCustomer(t.app, dono, { name: 'João Lima' });
    const carroMaria = await createVehicle(t.app, dono, maria.id, { plate: 'ANA1A23' });
    const carroJoao = await createVehicle(t.app, dono, joao.id, { plate: 'ANA2B34' });

    const os1 = await finalizar(maria.id, carroMaria.id, [{ type: 'SERVICE', serviceId: alinhamento }]);
    await completar(os1);
    // finalizada exatamente há um mês: cai no trecho anterior, e faz a Maria "voltar"
    await naOficina(sql`update work_orders set completed_at = now() - interval '1 month' where id = ${os1.id}`);

    const os2 = await finalizar(maria.id, carroMaria.id, [
      { type: 'SERVICE', serviceId: revisao },
      { type: 'PART', partId: filtro, quantity: 1 },
    ]);
    const itemRevisao = os2.items.find((i) => i.description.includes('Revisão'))!.id;
    expect((await post(`/api/v1/work-orders/${os2.id}/items/${itemRevisao}/timer/start`, {}, mecanico)).statusCode).toBe(200);
    expect((await post(`/api/v1/work-orders/${os2.id}/items/${itemRevisao}/timer/stop`, {}, mecanico)).statusCode).toBe(200);
    // o cronômetro de verdade levaria 80 minutos: a volta fechada passa a valer isso
    await naOficina(sql`update work_order_item_timers set started_at = stopped_at - interval '80 minutes', minutes = 80 where work_order_item_id = ${itemRevisao}`);
    await completar(os2);

    const os3 = await finalizar(joao.id, carroJoao.id, [
      { type: 'SERVICE', serviceId: alinhamento },
      { type: 'PART', partId: filtro, quantity: 2 },
    ]);
    await completar(os3);

    const res = await req('/api/v1/finance/analises?meses=1');
    expect(res.statusCode, res.body).toBe(200);
    a = res.json();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('faturado, OS e ticket médio do período, contra o mesmo trecho do mês passado', () => {
    expect(a.indicadores.faturadoCents).toEqual({ atual: 270_000, anterior: 20_000 });
    expect(a.indicadores.ordens).toEqual({ atual: 2, anterior: 1 });
    expect(a.indicadores.ticketMedioCents).toEqual({ atual: 135_000, anterior: 20_000 });
  });

  it('clientes que voltaram: a Maria já tinha vindo antes, o João é novo', () => {
    expect(a.indicadores.clientes.atendidos).toEqual({ atual: 2, anterior: 1 });
    expect(a.indicadores.clientes.voltaram).toEqual({ atual: 1, anterior: 0 });
  });

  it('serviço mais lucrativo = cobrado − comissão, por hora do cronômetro (ou do catálogo)', () => {
    expect(a.servicos).toEqual([
      {
        servico: 'Revisão',
        vezes: 1,
        faturadoCents: 100_000,
        comissaoCents: 10_000,
        lucroCents: 90_000,
        minutos: 80,
        fonteDoTempo: 'cronometro',
        // R$ 900 em 80 min = R$ 675 por hora
        lucroPorHoraCents: 67_500,
      },
      {
        servico: 'Alinhamento',
        vezes: 1,
        faturadoCents: 20_000,
        comissaoCents: 2_000,
        lucroCents: 18_000,
        minutos: 30,
        fonteDoTempo: 'catalogo',
        lucroPorHoraCents: 36_000,
      },
    ]);
  });

  it('peças que mais saem e o giro do estoque', () => {
    // o estoque da oficina começou hoje: o ritmo de saída é o de 1 dia, não o do mês inteiro
    const dias = 1;
    expect(a.pecas).toEqual([
      { peca: 'Filtro de óleo', quantidade: 3, custoCents: 90_000, saldo: 2, diasDeEstoque: Math.round(2 / (3 / dias)) },
    ]);
    // o estoque inicial entrou neste mês: no começo do período valia zero; agora, 2 × R$ 300
    expect(a.indicadores.estoque).toEqual({
      custoSaidasCents: 90_000,
      inicialCents: 0,
      finalCents: 60_000,
      giroCentesimos: 300,
      diasDeEstoque: Math.round(60_000 / (90_000 / dias)),
    });
  });

  it('produtividade: horas vendidas × trabalhadas; a eficiência só compara o que foi cronometrado', () => {
    expect(a.mecanicos).toEqual([
      { mecanico: 'Bruno', servicos: 2, faturadoCents: 120_000, vendidoMin: 90, trabalhadoMin: 80, eficienciaBps: 7_500 },
    ]);
    expect(a.indicadores.equipe).toEqual({ vendidoMin: 90, trabalhadoMin: 80, eficienciaBps: 7_500 });
  });

  it('o mês a mês bate com a DRE de cada mês', async () => {
    expect(a.mesAMes).toHaveLength(12);
    const atual = a.mesAMes.at(-1)!;
    const passado = a.mesAMes.at(-2)!;
    expect(atual.mes).toBe(a.periodo.ate.slice(0, 7));
    expect(atual).toMatchObject({ faturadoCents: 270_000, ordens: 2, ticketMedioCents: 135_000 });
    expect(passado).toMatchObject({ faturadoCents: 20_000, ordens: 1, parcial: false });
    const dre = (await req('/api/v1/finance/dre?period=month')).json() as { lines: { key: string; amountCents: number }[] };
    expect(atual.lucroLiquidoCents).toBe(dre.lines.find((l) => l.key === 'lucro_liquido')!.amountCents);
    expect(a.mesAMes.slice(0, -2).every((m) => m.faturadoCents === 0 && m.ordens === 0)).toBe(true);
  });

  it('só quem vê o financeiro, e só janelas de 1, 3, 6 ou 12 meses', async () => {
    expect((await req('/api/v1/finance/analises', mecanico)).statusCode).toBe(403);
    expect((await req('/api/v1/finance/analises?meses=5')).statusCode).toBe(400);
    const tres = (await req('/api/v1/finance/analises?meses=3')).json() as Analises;
    // com 3 meses, a OS do mês passado entra no período, e a Maria deixa de "voltar"
    expect(tres.indicadores.ordens.atual).toBe(3);
    expect(tres.indicadores.clientes.voltaram.atual).toBe(0);
  });
});
