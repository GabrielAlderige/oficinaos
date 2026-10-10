import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
import { etapaDoTeste } from '../src/modules/billing/ciclo-do-teste';
import { createTestApp, signup, testDb, type TestApp, type TestSession } from './helpers';

/**
 * Os e-mails do teste grátis. O que precisa ficar provado: as boas-vindas
 * saem no cadastro; cada etapa sai UMA vez; nada sai de madrugada; e quem já
 * assinou não recebe aviso de fim de teste.
 */
const DIA = 86_400_000;
/** 10h em São Paulo (13h UTC): horário comercial da oficina. */
const DEZ_DA_MANHA = new Date('2026-10-08T13:00:00Z');
/** 3h da manhã em São Paulo. */
const MADRUGADA = new Date('2026-10-08T06:00:00Z');

describe('etapa do teste', () => {
  const base = { status: 'TRIALING', providerSubscriptionId: null };
  const faltando = (ms: number) => ({ ...base, trialEndsAt: new Date(DEZ_DA_MANHA.getTime() + ms) });

  it('escolhe a etapa pelo tempo que falta', () => {
    expect(etapaDoTeste(faltando(10 * DIA), DEZ_DA_MANHA)).toBeNull();
    expect(etapaDoTeste(faltando(6 * DIA), DEZ_DA_MANHA)).toBe('METADE_DO_TESTE');
    expect(etapaDoTeste(faltando(2.5 * DIA), DEZ_DA_MANHA)).toBe('FALTAM_3_DIAS');
    expect(etapaDoTeste(faltando(12 * 3_600_000), DEZ_DA_MANHA)).toBe('ULTIMO_DIA');
    expect(etapaDoTeste(faltando(-DIA), DEZ_DA_MANHA)).toBe('TESTE_ACABOU');
    expect(etapaDoTeste(faltando(-10 * DIA), DEZ_DA_MANHA), 'acabou há muito tempo: não manda atrasado').toBeNull();
  });

  it('quem já assinou não recebe aviso de fim de teste', () => {
    expect(etapaDoTeste({ ...faltando(2 * DIA), providerSubscriptionId: 'sub_1' }, DEZ_DA_MANHA)).toBeNull();
    expect(etapaDoTeste({ ...faltando(2 * DIA), status: 'ACTIVE' }, DEZ_DA_MANHA)).toBeNull();
  });
});

describe('e-mails do teste grátis', () => {
  let t: TestApp;
  let dono: TestSession;
  const { db } = testDb();

  const fimDoTesteEm = (ms: number) =>
    withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute(
        sql`update subscriptions set trial_ends_at = ${new Date(DEZ_DA_MANHA.getTime() + ms)} where organization_id = ${dono.orgId}`,
      ),
    );
  const enviados = () => t.email.sent.filter((m) => m.to === dono.email);

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app, { name: 'Marcos Oliveira', organizationName: 'Auto Mecânica Oliveira' });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('as boas-vindas saem no cadastro, explicando os 14 dias', () => {
    const boasVindas = enviados().filter((m) => m.subject.startsWith('Bem-vindo'));
    expect(boasVindas, 'uma vez só').toHaveLength(1);
    expect(boasVindas[0]!.subject).toBe('Bem-vindo ao OficinaOS, Marcos!');
    expect(boasVindas[0]!.text).toContain('14 dias grátis');
    expect(boasVindas[0]!.text).toContain('Auto Mecânica Oliveira');
  });

  it('cada etapa sai uma vez, na hora certa', async () => {
    await fimDoTesteEm(6 * DIA);
    expect(await t.app.services.cicloDoTeste.enviarDevido(dono.orgId, DEZ_DA_MANHA)).toBe('METADE_DO_TESTE');
    expect(await t.app.services.cicloDoTeste.enviarDevido(dono.orgId, DEZ_DA_MANHA), 'não repete').toBeNull();

    await fimDoTesteEm(2 * DIA);
    expect(await t.app.services.cicloDoTeste.enviarDevido(dono.orgId, DEZ_DA_MANHA)).toBe('FALTAM_3_DIAS');
    const faltam = enviados().at(-1)!;
    expect(faltam.subject).toBe('Faltam 3 dias do seu teste no OficinaOS');
    expect(faltam.text, 'os planos, com o preço da tabela').toContain('Turbo: R$');
    expect(faltam.text).toContain('/configuracoes/plano');
  });

  it('de madrugada não manda: espera o horário comercial', async () => {
    await fimDoTesteEm(12 * 3_600_000);
    expect(await t.app.services.cicloDoTeste.enviarDevido(dono.orgId, MADRUGADA)).toBeNull();
    expect(await t.app.services.cicloDoTeste.enviarDevido(dono.orgId, DEZ_DA_MANHA)).toBe('ULTIMO_DIA');
  });

  it('quando acaba, avisa que os dados continuam lá', async () => {
    await fimDoTesteEm(-DIA);
    expect(await t.app.services.cicloDoTeste.enviarDevido(dono.orgId, DEZ_DA_MANHA)).toBe('TESTE_ACABOU');
    expect(enviados().at(-1)!.text, 'a carência: ainda funciona por 7 dias').toContain('nada parou: até 14/10');
    expect(enviados().filter((m) => m.subject.startsWith('Bem-vindo')), 'e as boas-vindas não voltaram').toHaveLength(1);
  });

  it('quem assinou durante o teste não recebe os avisos', async () => {
    const outro = await signup(t.app);
    await withTenant(db, { organizationId: outro.orgId }, (tx) =>
      tx.execute(
        sql`update subscriptions set provider_subscription_id = 'sub_teste', trial_ends_at = ${new Date(DEZ_DA_MANHA.getTime() + 2 * DIA)} where organization_id = ${outro.orgId}`,
      ),
    );
    expect(await t.app.services.cicloDoTeste.enviarDevido(outro.orgId, DEZ_DA_MANHA)).toBeNull();
  });
});
