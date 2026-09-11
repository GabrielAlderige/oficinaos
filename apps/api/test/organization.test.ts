import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityLogs } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import { addMember, bearer, createTestApp, signup, testDb, type TestApp } from './helpers';

describe('dados da oficina', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  const patch = (token: string, payload: Record<string, unknown>) =>
    t.app.inject({ method: 'PATCH', url: '/api/v1/organization', headers: bearer(token), payload });

  it('dono atualiza; os dados saem normalizados e a mudança fica auditada', async () => {
    const owner = await signup(t.app);
    const res = await patch(owner.accessToken, {
      legalName: 'Oficina do Zé LTDA',
      document: '12.abc.345/01de-35', // CNPJ alfanumérico
      phone: '(21) 3456-7890',
      email: 'Contato@Oficina.com.br',
      address: {
        zip: '01310-100',
        street: 'Av. Paulista',
        number: '1000',
        complement: '',
        district: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      },
      timezone: 'America/Sao_Paulo',
      businessHours: { mon: [['08:00', '12:00'], ['13:00', '18:00']], sat: [['08:00', '12:00']] },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      legalName: 'Oficina do Zé LTDA',
      document: '12ABC34501DE35',
      phone: '+552134567890',
      email: 'contato@oficina.com.br',
      address: { zip: '01310100', city: 'São Paulo', state: 'SP' },
      businessHours: { sat: [['08:00', '12:00']] },
    });

    const logs = await withTenant(testDb().db, { organizationId: owner.orgId }, (tx) =>
      tx.select().from(activityLogs).where(eq(activityLogs.action, 'organization.updated')),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]!.changes).toMatchObject({ document: { from: null, to: '12ABC34501DE35' } });
  });

  it('valida documento, UF e horário campo a campo', async () => {
    const owner = await signup(t.app);
    const res = await patch(owner.accessToken, {
      document: '11.222.333/0001-82',
      address: { zip: '123', street: '', number: '', complement: '', district: '', city: '', state: 'XX' },
      businessHours: { mon: [['18:00', '08:00']] },
    });
    expect(res.statusCode).toBe(400);
    const paths: string[] = res.json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['body.document', 'body.address.zip', 'body.address.state']));
    expect(paths.some((p) => p.startsWith('body.businessHours.mon'))).toBe(true);
  });

  it('campo em branco limpa o valor', async () => {
    const owner = await signup(t.app);
    await patch(owner.accessToken, { legalName: 'Razão Social' });
    const res = await patch(owner.accessToken, { legalName: '' });
    expect(res.json().legalName).toBeNull();
  });

  it('sem mudança de verdade, nada é auditado', async () => {
    const owner = await signup(t.app, { organizationName: 'Mesma Oficina' });
    await patch(owner.accessToken, { name: 'Mesma Oficina' });
    const logs = await withTenant(testDb().db, { organizationId: owner.orgId }, (tx) =>
      tx.select().from(activityLogs).where(eq(activityLogs.action, 'organization.updated')),
    );
    expect(logs).toHaveLength(0);
  });

  it('atendente lê, mas não altera', async () => {
    const owner = await signup(t.app);
    const attendant = await addMember(t.app, owner, 'ATTENDANT');
    const read = await t.app.inject({ method: 'GET', url: '/api/v1/organization', headers: bearer(attendant.accessToken) });
    expect(read.statusCode).toBe(200);
    expect((await patch(attendant.accessToken, { name: 'Invadida' })).statusCode).toBe(403);
  });
});
