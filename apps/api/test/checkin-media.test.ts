import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
import {
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  nextIp,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

interface TestAttachment {
  id: string;
  kind: string;
  status: string;
  url: string | null;
  posterUrl: string | null;
  expiresAt: string | null;
  visibleToCustomer: boolean;
  inspectionId: string | null;
}

interface TestInspection {
  id: string;
  type: string;
  photos: TestAttachment[];
  videos: TestAttachment[];
}

const FOTO = Buffer.from('jpeg da foto do carro', 'utf8');
const VIDEO = Buffer.from('bytes de um vídeo .mov do iPhone, 0123456789', 'utf8');
const DIA_MS = 24 * 60 * 60 * 1000;

let placas = 0;
function nextPlate(): string {
  placas += 1;
  const letra = String.fromCharCode(65 + (placas % 26));
  return `CKM${placas % 10}${letra}${String(placas % 100).padStart(2, '0')}`;
}

/**
 * E47: a foto e o vídeo da ENTRADA do carro presos ao check-in (antes a foto
 * subia para a OS e nunca aparecia de novo), a foto do defeito sem item no
 * orçamento, e a mensagem do WhatsApp que conta que tem foto e vídeo.
 */
describe('foto e vídeo da entrada, e a mídia do orçamento (E47)', () => {
  let t: TestApp;
  let owner: TestSession;
  let serviceId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    const service = await t.app.inject({
      method: 'POST',
      url: '/api/v1/services',
      headers: bearer(owner.accessToken),
      payload: { name: 'Troca de discos de freio', priceCents: 42000 },
    });
    serviceId = service.json().id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const post = (url: string, payload: Record<string, unknown> = {}) =>
    t.app.inject({ method: 'POST', url, headers: bearer(owner.accessToken), payload });
  const get = (url: string) => t.app.inject({ method: 'GET', url, headers: bearer(owner.accessToken) });
  const publicGet = (url: string) => t.app.inject({ method: 'GET', url, remoteAddress: nextIp() });

  async function novaOS() {
    const customer = await createCustomer(t.app, owner, { name: 'Carlos Lima', whatsapp: '(35) 99876-5432' });
    const vehicle = await createVehicle(t.app, owner, customer.id, { plate: nextPlate() });
    return createWorkOrder(t.app, owner, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      items: [{ type: 'SERVICE', serviceId }],
    }) as Promise<{ id: string; number: number }>;
  }

  async function foto(workOrderId: string, payload: Record<string, unknown> = {}) {
    const bilhete = await post('/api/v1/uploads', {
      kind: 'PHOTO',
      mimeType: 'image/jpeg',
      sizeBytes: FOTO.byteLength,
      workOrderId,
      ...payload,
    });
    expect(bilhete.statusCode, bilhete.body).toBe(201);
    const { attachment, uploadUrl } = bilhete.json();
    await t.app.inject({ method: 'PUT', url: uploadUrl, headers: { 'content-type': 'image/jpeg' }, payload: FOTO });
    expect((await post(`/api/v1/uploads/${attachment.id}/complete`)).statusCode).toBe(200);
    return attachment.id as string;
  }

  async function video(workOrderId: string, payload: Record<string, unknown> = {}, esperar = true) {
    const bilhete = await post('/api/v1/uploads/videos', {
      mimeType: 'video/quicktime',
      sizeBytes: VIDEO.byteLength,
      workOrderId,
      ...payload,
    });
    expect(bilhete.statusCode, bilhete.body).toBe(201);
    const { attachment, uploadUrl } = bilhete.json();
    await t.app.inject({ method: 'PUT', url: uploadUrl, headers: { 'content-type': 'video/quicktime' }, payload: VIDEO });
    expect((await post(`/api/v1/uploads/${attachment.id}/complete`)).statusCode).toBe(200);
    if (esperar) await t.app.services.videoProcessor.ocioso();
    return attachment.id as string;
  }

  const checkIn = (workOrderId: string, attachmentIds: string[]) =>
    post(`/api/v1/work-orders/${workOrderId}/inspections`, { type: 'CHECK_IN', odometerKm: null, attachmentIds });

  async function inspecoes(workOrderId: string): Promise<TestInspection[]> {
    return (await get(`/api/v1/work-orders/${workOrderId}/inspections`)).json().data;
  }

  async function anexos(workOrderId: string): Promise<TestAttachment[]> {
    return (await get(`/api/v1/work-orders/${workOrderId}/attachments`)).json().data;
  }

  const sqlNaOficina = (consulta: ReturnType<typeof sql>) =>
    withTenant(testDb().db, { organizationId: owner.orgId }, (tx) => tx.execute(consulta));

  async function enviarOrcamento(workOrderId: string) {
    const quote = await post(`/api/v1/work-orders/${workOrderId}/quotes`, {});
    expect(quote.statusCode, quote.body).toBe(201);
    const token = (quote.json().publicUrl as string).split('/').pop()!;
    return { id: quote.json().id as string, token };
  }

  describe('check-in com foto e vídeo', () => {
    it('a foto e o vídeo ficam presos ao check-in e aparecem nele', async () => {
      const os = await novaOS();
      const fotoId = await foto(os.id);
      const videoId = await video(os.id);

      const res = await checkIn(os.id, [fotoId, videoId]);
      expect(res.statusCode, res.body).toBe(201);

      const [entrada] = await inspecoes(os.id);
      expect(entrada!.type).toBe('CHECK_IN');
      expect(entrada!.photos.map((a) => a.id)).toEqual([fotoId]);
      expect(entrada!.photos[0]!.url).toContain('/api/v1/uploads/object?');
      expect(entrada!.videos).toHaveLength(1);
      expect(entrada!.videos[0]).toMatchObject({ id: videoId, status: 'READY', expiresAt: null });
      expect(entrada!.videos[0]!.posterUrl).toContain('/api/v1/uploads/object?');

      // na lista da OS eles dizem de qual check-in são (o cartão do defeito deixa de fora)
      const lista = await anexos(os.id);
      expect(lista.filter((a) => a.inspectionId === entrada!.id).map((a) => a.id).sort()).toEqual([fotoId, videoId].sort());
    });

    it('o vídeo ainda convertendo aparece no check-in como "preparando"', async () => {
      const os = await novaOS();
      const soltar = t.transcoder.segurar();
      const videoId = await video(os.id, {}, false);
      expect((await checkIn(os.id, [videoId])).statusCode).toBe(201);
      expect((await inspecoes(os.id))[0]!.videos[0]).toMatchObject({ id: videoId, status: 'PROCESSING', url: null });
      soltar();
      await t.app.services.videoProcessor.ocioso();
      expect((await inspecoes(os.id))[0]!.videos[0]!.status).toBe('READY');
    });

    it('não vai para o orçamento nem para a página "acompanhar", mesmo enviado como visível', async () => {
      const os = await novaOS();
      const videoId = await video(os.id, { visibleToCustomer: true });
      const fotoId = await foto(os.id, { visibleToCustomer: true });
      expect((await checkIn(os.id, [videoId, fotoId])).statusCode).toBe(201);
      expect((await anexos(os.id)).every((a) => !a.visibleToCustomer)).toBe(true);

      const { token } = await enviarOrcamento(os.id);
      const publico = (await publicGet(`/api/v1/public/quotes/${token}`)).json();
      expect(publico.videos).toEqual([]);
      expect(publico.photos).toEqual([]);
      expect(publico.items[0].photos).toEqual([]);

      const link = (await post(`/api/v1/work-orders/${os.id}/tracking-link`)).json().publicUrl as string;
      const pagina = (await publicGet(`/api/v1/public/tracking/${link.slice(link.lastIndexOf('/') + 1)}`)).json();
      expect(pagina.videos).toEqual([]);
    });

    it('mesmo marcado como visível por fora, o que é do check-in não vai ao cliente', async () => {
      const os = await novaOS();
      const videoId = await video(os.id);
      const fotoId = await foto(os.id);
      expect((await checkIn(os.id, [videoId, fotoId])).statusCode).toBe(201);
      // um caminho futuro que esqueça de desmarcar não pode vazar a prova da oficina
      await sqlNaOficina(sql`update attachments set visible_to_customer = true where id in (${videoId}, ${fotoId})`);

      const { token } = await enviarOrcamento(os.id);
      const publico = (await publicGet(`/api/v1/public/quotes/${token}`)).json();
      expect(publico.videos).toEqual([]);
      expect(publico.photos).toEqual([]);
      const link = (await post(`/api/v1/work-orders/${os.id}/tracking-link`)).json().publicUrl as string;
      expect((await publicGet(`/api/v1/public/tracking/${link.slice(link.lastIndexOf('/') + 1)}`)).json().videos).toEqual([]);
    });

    it('recusa anexo de outra OS, e o check-in não fica pela metade', async () => {
      const os = await novaOS();
      const outra = await novaOS();
      const daOutra = await foto(outra.id);
      const minha = await foto(os.id);

      const res = await checkIn(os.id, [minha, daOutra]);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await inspecoes(os.id)).toEqual([]);
      // a foto que era desta OS continua solta: a transação inteira voltou
      expect((await anexos(os.id))[0]!.inspectionId).toBeNull();
    });

    it('recusa a foto que já é de outro check-in', async () => {
      const os = await novaOS();
      const fotoId = await foto(os.id);
      expect((await checkIn(os.id, [fotoId])).statusCode).toBe(201);
      expect((await checkIn(os.id, [fotoId])).statusCode).toBe(400);
    });

    it('sem foto nem vídeo, o check-in é o de sempre', async () => {
      const os = await novaOS();
      expect((await checkIn(os.id, [])).statusCode).toBe(201);
      expect((await inspecoes(os.id))[0]).toMatchObject({ photos: [], videos: [] });
    });
  });

  describe('quanto tempo o vídeo da entrada fica', () => {
    const limpar = (agora?: Date) => t.app.services.videos.apagarVencidos(owner.orgId, agora);

    it('com o carro na oficina, não sai nem depois de 30 dias', async () => {
      const os = await novaOS();
      const videoId = await video(os.id);
      expect((await checkIn(os.id, [videoId])).statusCode).toBe(201);
      await sqlNaOficina(sql`update attachments set created_at = now() - interval '45 days' where id = ${videoId}`);
      await limpar();
      expect((await inspecoes(os.id))[0]!.videos[0]!.status).toBe('READY');
    });

    it('cancelada a OS, ganha 30 dias; passou, sai do disco e o check-in diz quando', async () => {
      const os = await novaOS();
      const videoId = await video(os.id);
      expect((await checkIn(os.id, [videoId])).statusCode).toBe(201);

      const cancelada = await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'Cliente desistiu' });
      expect(cancelada.statusCode, cancelada.body).toBe(200);
      const prazo = Date.parse((await inspecoes(os.id))[0]!.videos[0]!.expiresAt!);
      expect(Math.abs(prazo - (Date.now() + 30 * DIA_MS))).toBeLessThan(60_000);

      await limpar(new Date(prazo - 60_000));
      expect((await inspecoes(os.id))[0]!.videos[0]!.status).toBe('READY');
      await limpar(new Date(prazo + 60_000));
      expect((await inspecoes(os.id))[0]!.videos[0]).toMatchObject({ status: 'EXPIRED', url: null });
      expect([...t.storage.objects.keys()].some((chave) => chave.includes(videoId))).toBe(false);
    });

    it('o prazo do vídeo do DEFEITO não muda quando a OS fecha', async () => {
      const os = await novaOS();
      const defeito = await video(os.id);
      await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'Cliente desistiu' });
      expect((await anexos(os.id)).find((a) => a.id === defeito)!.expiresAt).toBeNull();
    });
  });

  describe('foto do defeito no orçamento', () => {
    it('a foto do item vai dentro do item; a da OS em geral vai na lista de fotos', async () => {
      const os = await novaOS();
      const itemId = (await get(`/api/v1/work-orders/${os.number}`)).json().items[0].id as string;
      const doItem = await foto(os.id, { visibleToCustomer: true, workOrderItemId: itemId, caption: 'Disco riscado' });
      const geral = await foto(os.id, { visibleToCustomer: true, caption: 'Vista de baixo' });
      await foto(os.id, { visibleToCustomer: false });

      const { token } = await enviarOrcamento(os.id);
      const publico = (await publicGet(`/api/v1/public/quotes/${token}`)).json();
      expect(publico.items[0].photos.map((p: { id: string }) => p.id)).toEqual([doItem]);
      expect(publico.photos).toHaveLength(1);
      expect(publico.photos[0]).toMatchObject({ id: geral, caption: 'Vista de baixo' });
    });
  });

  describe('a mensagem do WhatsApp conta que tem foto e vídeo', () => {
    const mensagem = async (quoteId: string) => {
      const res = await post(`/api/v1/quotes/${quoteId}/share`, { channel: 'WHATSAPP_LINK' });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().message as string;
    };

    it('com vídeo do defeito', async () => {
      const os = await novaOS();
      await video(os.id);
      const { id } = await enviarOrcamento(os.id);
      expect(await mensagem(id)).toContain('Gravamos um vídeo mostrando o que encontramos no carro.');
    });

    it('com foto e vídeo', async () => {
      const os = await novaOS();
      await video(os.id);
      await foto(os.id, { visibleToCustomer: true });
      const { id } = await enviarOrcamento(os.id);
      expect(await mensagem(id)).toContain('Gravamos um vídeo e tiramos fotos');
    });

    it('o vídeo apagado depois de o orçamento sair não conta mais', async () => {
      const os = await novaOS();
      const videoId = await video(os.id);
      const { id } = await enviarOrcamento(os.id);
      const apagar = await t.app.inject({ method: 'DELETE', url: `/api/v1/uploads/${videoId}`, headers: bearer(owner.accessToken) });
      expect(apagar.statusCode).toBe(204);
      expect(await mensagem(id)).not.toMatch(/vídeo/);
    });

    it('o vídeo da entrada e o que é só da oficina não contam', async () => {
      const os = await novaOS();
      const entrada = await video(os.id);
      expect((await checkIn(os.id, [entrada])).statusCode).toBe(201);
      await video(os.id, { visibleToCustomer: false });
      const { id } = await enviarOrcamento(os.id);
      expect(await mensagem(id)).not.toMatch(/vídeo|foto/);
    });
  });
});
