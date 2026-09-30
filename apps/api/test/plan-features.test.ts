import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  PLAN_CODES,
  PLAN_FEATURE_MATRIX,
  PLAN_FEATURES,
  ROADMAP_FEATURES,
  planoMaisBaratoCom,
  TRIAL_PLAN,
} from '@oficinaos/shared';
import { withTenant } from '../src/db/tenant';
import {
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

/**
 * Os planos passaram a valer de verdade (E40).
 *
 * O que este arquivo guarda, e por quê: antes da E40 a coluna `features` era
 * lida só para desenhar a tela de planos e NUNCA para decidir nada. A tela
 * prometia fornecedores, relatórios e comissões no Supercharger, e a API
 * entregava tudo isso para quem pagava o Turbo. Agora que a API barra, banco e
 * código não podem divergir um do outro: divergir aqui significa vender o que
 * a API recusa, ou recusar o que foi vendido.
 */
describe('planos: o que está na tabela é o que o código aplica', () => {
  let t: TestApp;
  let oficina: TestSession;

  beforeAll(async () => {
    t = await createTestApp();
    oficina = await signup(t.app);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('a coluna `features` do banco bate exatamente com PLAN_FEATURE_MATRIX', async () => {
    const { rows } = await testDb().db.execute<{ code: string; features: string[] }>(
      sql`select code, features from plans order by code`,
    );
    expect(rows.length, 'os três planos existem').toBe(PLAN_CODES.length);

    for (const linha of rows) {
      const doCodigo = PLAN_FEATURE_MATRIX[linha.code as keyof typeof PLAN_FEATURE_MATRIX];
      expect(doCodigo, `plano ${linha.code} sem matriz no código`).toBeDefined();
      expect(
        [...linha.features].sort(),
        `o banco e packages/shared/src/enums/plan-features.ts divergiram no plano ${linha.code}`,
      ).toEqual([...doCodigo].sort());
    }
  });

  it('nenhum plano vende o que não existe', async () => {
    const { rows } = await testDb().db.execute<{ code: string; features: string[] }>(
      sql`select code, features from plans`,
    );
    const conhecidas = new Set<string>(PLAN_FEATURES);
    const fantasmas = new Set<string>(ROADMAP_FEATURES);

    for (const linha of rows) {
      for (const recurso of linha.features) {
        // multi_branch, custom_roles e public_api já estiveram aqui com visual
        // de incluído, vendendo por R$ 499 o que não tinha uma linha de código
        expect(fantasmas.has(recurso), `${linha.code} vende "${recurso}", que está no roadmap e não existe`).toBe(false);
        expect(conhecidas.has(recurso), `${linha.code} tem "${recurso}", que não está em PLAN_FEATURES`).toBe(true);
      }
    }
  });

  it('os planos são crescentes: o de cima nunca tira nada do de baixo', () => {
    const { TURBO, SUPERCHARGER, NITRO } = PLAN_FEATURE_MATRIX;
    for (const recurso of TURBO) {
      expect(SUPERCHARGER, `Supercharger perdeu "${recurso}" que o Turbo tem`).toContain(recurso);
    }
    for (const recurso of SUPERCHARGER) {
      expect(NITRO, `Nitro perdeu "${recurso}" que o Supercharger tem`).toContain(recurso);
    }
    // e toda funcionalidade mora em algum plano, senão ninguém consegue comprá-la
    for (const recurso of PLAN_FEATURES) {
      expect(planoMaisBaratoCom(recurso), `"${recurso}" não está em plano nenhum`).not.toBeNull();
    }
  });

  it('o teste de 14 dias entra no plano mais alto, com tudo aberto', async () => {
    const visao = await t.app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: bearer(oficina.accessToken),
    });
    expect(visao.statusCode).toBe(200);
    const dados = visao.json<{ plan: string }>();
    // quem termina o teste sem ter visto pesquisa de peças, WhatsApp oficial e
    // automações não paga por elas: o teste precisa mostrar o produto inteiro
    expect(dados.plan).toBe(TRIAL_PLAN);
    expect(PLAN_FEATURE_MATRIX[TRIAL_PLAN], 'o plano do teste tem de ter tudo').toEqual(
      expect.arrayContaining([...PLAN_FEATURES]),
    );
  });

  it('a API barra a funcionalidade fora do plano, com 402 e o plano que a libera', async () => {
    const { db } = testDb();
    const orgId = oficina.orgId;
    // desce a oficina para o Turbo direto no banco: é o estado de quem assinou
    // o plano de entrada, sem depender do gateway.
    // `withTenant` é obrigatório: `subscriptions` tem RLS FORÇADO, e um update
    // solto daqui atingiria zero linhas em silêncio — o teste passaria a não
    // cobrir nada e ainda pareceria verde
    await withTenant(db, { organizationId: orgId }, (tx) =>
      tx.execute(
        sql`update subscriptions set plan_id = (select id from plans where code = 'TURBO') where organization_id = ${orgId}`,
      ),
    );
    // o plano vive num cache de curta duração junto com a assinatura: sem
    // limpar, o guard continuaria decidindo pelo Nitro do teste
    t.app.caches.subscriptions.delete(orgId);

    const resposta = await t.app.inject({
      method: 'POST',
      url: '/api/v1/parts-search',
      headers: bearer(oficina.accessToken),
      payload: { q: 'pastilha' },
    });

    expect(resposta.statusCode, 'Payment Required: é falta de plano, não de permissão').toBe(402);
    const problema = resposta.json<{ code: string; meta?: { feature: string; requiredPlan: string } }>();
    expect(problema.code).toBe('PLAN_FEATURE_REQUIRED');
    // o painel usa isto para abrir o convite já no plano certo
    expect(problema.meta?.feature).toBe('parts_search');
    expect(problema.meta?.requiredPlan).toBe('NITRO');
  });

  it('o teto de OS por mês do plano é aplicado, não só exibido', async () => {
    // "Até 150 OS por mês" estava escrito na tela do Turbo e não era aplicado
    // em lugar nenhum (E40). Baixar o teto para 1 prova a regra sem abrir 150
    // ordens — e devolve o valor no finally, senão os outros cenários herdam
    const teto = (valor: string) =>
      testDb().db.execute(sql.raw(`update plans set limits = jsonb_set(limits, '{maxWorkOrdersPerMonth}', '${valor}') where code = 'TURBO'`));
    await teto('1');
    try {
      const cliente = await createCustomer(t.app, oficina);
      const veiculo = await createVehicle(t.app, oficina, cliente.id);

      const primeira = await t.app.inject({
        method: 'POST',
        url: '/api/v1/work-orders',
        headers: bearer(oficina.accessToken),
        payload: { customerId: cliente.id, vehicleId: veiculo.id, complaint: 'barulho na frente' },
      });
      expect(primeira.statusCode, primeira.body).toBe(201);

      const segunda = await t.app.inject({
        method: 'POST',
        url: '/api/v1/work-orders',
        headers: bearer(oficina.accessToken),
        payload: { customerId: cliente.id, vehicleId: veiculo.id, complaint: 'revisão' },
      });
      expect(segunda.statusCode, 'a 2ª OS do mês não cabe no teto de 1').toBe(402);
      const problema = segunda.json<{ code: string; detail: string }>();
      expect(problema.code).toBe('PLAN_LIMIT_REACHED');
      // a mensagem tem de dizer as duas saídas: virar o mês ou subir de plano
      expect(problema.detail).toContain('virada do mês');
    } finally {
      await teto('150');
    }
  });

  it('o que o Turbo inclui continua funcionando depois de descer de plano', async () => {
    // a mesma oficina do teste anterior, ainda no Turbo: o bloqueio tem de ser
    // cirúrgico. Barrar a mais é o que faz a pessoa achar que o sistema quebrou
    const clientes = await t.app.inject({
      method: 'GET',
      url: '/api/v1/customers',
      headers: bearer(oficina.accessToken),
    });
    expect(clientes.statusCode, 'clientes está no Turbo').toBe(200);

    const conversas = await t.app.inject({
      method: 'GET',
      url: '/api/v1/messaging/conversations',
      headers: bearer(oficina.accessToken),
    });
    expect(conversas.statusCode, 'a tela de Conversas existe em todo plano').toBe(200);
  });
});
