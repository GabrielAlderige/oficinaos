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

const PHOTO = Buffer.from('conteúdo binário da foto', 'utf8');

describe('anexos e fotos', () => {
  let t: TestApp;
  let owner: TestSession;
  let workOrderId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    const customer = await createCustomer(t.app, owner);
    const vehicle = await createVehicle(t.app, owner, customer.id);
    workOrderId = (await createWorkOrder(t.app, owner, { customerId: customer.id, vehicleId: vehicle.id })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const ticket = (payload: Record<string, unknown> = {}, s: TestSession = owner) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/uploads',
      headers: bearer(s.accessToken),
      payload: { kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: PHOTO.byteLength, workOrderId, ...payload },
    });

  const send = (url: string, body: Buffer, contentType = 'image/jpeg') =>
    t.app.inject({ method: 'PUT', url, headers: { 'content-type': contentType }, payload: body });

  it('o caminho completo: ticket, envio pela URL assinada, conferência e leitura', async () => {
    const created = await ticket();
    expect(created.statusCode, created.body).toBe(201);
    const { attachment, uploadUrl } = created.json();
    expect(attachment).toMatchObject({ status: 'PENDING_UPLOAD', url: null, kind: 'PHOTO' });
    expect(uploadUrl).toContain('/api/v1/uploads/object?');

    // o navegador envia direto, sem token: quem autoriza é a assinatura da URL
    expect((await send(uploadUrl, PHOTO)).statusCode).toBe(204);

    const done = await t.app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${attachment.id}/complete`,
      headers: bearer(owner.accessToken),
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'READY', sizeBytes: PHOTO.byteLength });

    const readUrl = done.json().url as string;
    const read = await t.app.inject({ method: 'GET', url: readUrl });
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toContain('image/jpeg');
    expect(read.rawPayload.equals(PHOTO)).toBe(true);
  });

  it('aparece na lista de anexos da OS, com URL temporária', async () => {
    const { attachment, uploadUrl } = (await ticket({ caption: 'Pastilha gasta' })).json();
    await send(uploadUrl, PHOTO);
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${attachment.id}/complete`,
      headers: bearer(owner.accessToken),
    });

    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/work-orders/${workOrderId}/attachments`,
      headers: bearer(owner.accessToken),
    });
    const found = list.json().data.find((a: { id: string }) => a.id === attachment.id);
    expect(found).toMatchObject({ caption: 'Pastilha gasta', status: 'READY' });
    expect(found.url).toContain('/api/v1/uploads/object?');
  });

  it('sem terminar o envio, o anexo não fica pronto', async () => {
    const { attachment } = (await ticket()).json();
    const done = await t.app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${attachment.id}/complete`,
      headers: bearer(owner.accessToken),
    });
    expect(done.statusCode).toBe(409);
    expect(done.json().code).toBe('UPLOAD_INCOMPLETE');
  });

  it('arquivo de tipo diferente do declarado é recusado na conferência', async () => {
    const { attachment, uploadUrl } = (await ticket()).json();
    await send(uploadUrl, PHOTO, 'image/png');
    const done = await t.app.inject({
      method: 'POST',
      url: `/api/v1/uploads/${attachment.id}/complete`,
      headers: bearer(owner.accessToken),
    });
    expect(done.statusCode).toBe(409);
    expect(done.json().code).toBe('UPLOAD_INCOMPLETE');
  });

  it('arquivo maior que o limite é recusado antes de subir', async () => {
    const res = await ticket({ sizeBytes: 50 * 1024 * 1024 });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0]).toMatchObject({ path: 'body.sizeBytes' });
  });

  it('vídeo ainda não é aceito (MVP 2)', async () => {
    expect((await ticket({ kind: 'VIDEO', mimeType: 'video/mp4' })).statusCode).toBe(400);
  });

  it('anexo tem que pertencer a alguma coisa', async () => {
    const res = await ticket({ workOrderId: null });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0]).toMatchObject({ path: 'body.workOrderId' });
  });

  describe('a assinatura da URL é a credencial', () => {
    it('URL adulterada não envia e não lê', async () => {
      const { uploadUrl } = (await ticket()).json();
      const mexida = uploadUrl.replace(/&s=.+$/, '&s=assinatura-inventada');
      expect((await send(mexida, PHOTO)).statusCode).toBe(403);
      expect((await t.app.inject({ method: 'GET', url: mexida })).statusCode).toBe(403);
    });

    it('a URL de envio não serve para ler (e vice-versa)', async () => {
      const { uploadUrl } = (await ticket()).json();
      // mesma assinatura, ação trocada para leitura
      expect((await t.app.inject({ method: 'GET', url: uploadUrl })).statusCode).toBe(403);
    });

    it('trocar a ação na URL invalida a assinatura (ela cobre a ação)', async () => {
      const { attachment, uploadUrl } = (await ticket()).json();
      expect(attachment.status).toBe('PENDING_UPLOAD');
      const leitura = uploadUrl.replace('a=put', 'a=get');
      expect((await t.app.inject({ method: 'GET', url: leitura })).statusCode).toBe(403);
    });
  });

  it('quem não mexe em OS não envia anexo', async () => {
    const finance = await addMember(t.app, owner, 'FINANCE');
    expect((await ticket({}, finance)).statusCode).toBe(403);
  });

  it('outra oficina não vê nem apaga o anexo', async () => {
    const { attachment } = (await ticket()).json();
    const other = await signup(t.app);
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/uploads/${attachment.id}`,
      headers: bearer(other.accessToken),
    });
    expect(del.statusCode).toBe(404);
  });
});
