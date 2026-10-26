import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiskStorageProvider, ObjectTooLargeError } from '../src/integrations/storage/storage';
import { withTenant } from '../src/db/tenant';
import { lerRange } from '../src/modules/uploads/uploads.routes';
import { duracaoDaSaida } from '../src/integrations/video/transcoder';
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

/** O que o teste usa do anexo. Tipado de verdade: `any` some do typecheck. */
interface TestAttachment {
  id: string;
  kind: string;
  status: string;
  mimeType: string;
  url: string | null;
  posterUrl: string | null;
  downloadUrl: string | null;
  durationSeconds: number | null;
  expiresAt: string | null;
}

interface TestPublicVideo {
  id: string;
  url: string | null;
  posterUrl: string | null;
  downloadUrl: string | null;
  itemDescription: string | null;
  expiresAt: string | null;
  expired: boolean;
}

/** "Vídeo" de mentira: o conversor falso só copia os bytes. */
const VIDEO = Buffer.from('bytes de um vídeo .mov do iPhone, 0123456789', 'utf8');
const DIA_MS = 24 * 60 * 60 * 1000;

let placas = 0;
function nextPlate(): string {
  placas += 1;
  const letra = String.fromCharCode(65 + (placas % 26));
  return `VDA${placas % 10}${letra}${String(placas % 100).padStart(2, '0')}`;
}

/**
 * Vídeo na OS (E45): o mecânico grava, o servidor converte, o vídeo vai no
 * orçamento e, 7 dias depois da resposta do cliente, sai do disco.
 */
describe('vídeo na OS', () => {
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
      payload: { name: 'Troca de pastilhas', priceCents: 18000 },
    });
    serviceId = service.json().id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const post = (url: string, payload: Record<string, unknown> = {}, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });
  const get = (url: string, s: TestSession = owner) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  async function novaOS(s: TestSession = owner) {
    const customer = await createCustomer(t.app, s, { name: 'Maria Souza', whatsapp: '(11) 91234-5678' });
    const vehicle = await createVehicle(t.app, s, customer.id, { plate: nextPlate() });
    // o serviço é da oficina do `owner`: as outras oficinas abrem a OS vazia
    return createWorkOrder(t.app, s, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      items: s === owner ? [{ type: 'SERVICE', serviceId }] : [],
    }) as Promise<{ id: string; number: number }>;
  }

  const ticket = (workOrderId: string, payload: Record<string, unknown> = {}, s: TestSession = owner) =>
    post('/api/v1/uploads/videos', { mimeType: 'video/quicktime', sizeBytes: VIDEO.byteLength, workOrderId, ...payload }, s);

  const send = (url: string, body: Buffer = VIDEO, contentType = 'video/quicktime') =>
    t.app.inject({ method: 'PUT', url, headers: { 'content-type': contentType }, payload: body });

  async function anexos(workOrderId: string): Promise<TestAttachment[]> {
    return (await get(`/api/v1/work-orders/${workOrderId}/attachments`)).json().data;
  }

  /** Grava, envia, confere e espera a conversão: o caminho do mecânico. */
  async function gravar(workOrderId: string, payload: Record<string, unknown> = {}): Promise<TestAttachment> {
    const criado = await ticket(workOrderId, payload);
    expect(criado.statusCode, criado.body).toBe(201);
    const { attachment, uploadUrl } = criado.json();
    expect((await send(uploadUrl)).statusCode).toBe(204);
    const pronto = await post(`/api/v1/uploads/${attachment.id}/complete`);
    expect(pronto.statusCode, pronto.body).toBe(200);
    await t.app.services.videoProcessor.ocioso();
    return (await anexos(workOrderId)).find((item) => item.id === attachment.id)!;
  }

  const sqlNaOficina = (consulta: ReturnType<typeof sql>) =>
    withTenant(testDb().db, { organizationId: owner.orgId }, (tx) => tx.execute(consulta));

  describe('gravar e converter', () => {
    it('o caminho inteiro: ticket, envio em fluxo, conversão, e o MP4 no lugar do original', async () => {
      const order = await novaOS();
      const criado = await ticket(order.id, { caption: 'Barulho na roda dianteira' });
      expect(criado.statusCode, criado.body).toBe(201);
      const { attachment, uploadUrl } = criado.json();
      expect(attachment).toMatchObject({ kind: 'VIDEO', status: 'PENDING_UPLOAD', url: null, posterUrl: null });

      expect((await send(uploadUrl)).statusCode).toBe(204);
      const conferido = await post(`/api/v1/uploads/${attachment.id}/complete`);
      expect(conferido.json()).toMatchObject({ status: 'PROCESSING', url: null });

      await t.app.services.videoProcessor.ocioso();
      const [video] = await anexos(order.id);
      expect(video).toMatchObject({
        id: attachment.id,
        status: 'READY',
        mimeType: 'video/mp4',
        durationSeconds: 12,
        expiresAt: null,
      });
      expect(video!.url).toContain('/api/v1/uploads/object?');
      expect(video!.posterUrl).toContain('/api/v1/uploads/object?');
      expect(video!.downloadUrl).toContain('download=1');

      // o original (o .mov de centenas de MB) saiu do disco; ficaram o MP4 e a capa
      const chaves = [...t.storage.objects.keys()].filter((chave) => chave.includes(attachment.id));
      expect(chaves.sort()).toEqual(
        [`videos/${owner.orgId}/${order.id}/${attachment.id}.jpg`, `videos/${owner.orgId}/${order.id}/${attachment.id}.mp4`].sort(),
      );
    });

    it('conferir duas vezes (clique duplo) não converte duas vezes', async () => {
      const order = await novaOS();
      const { attachment, uploadUrl } = (await ticket(order.id)).json();
      await send(uploadUrl);
      const antes = t.transcoder.convertidos.length;
      await post(`/api/v1/uploads/${attachment.id}/complete`);
      const segunda = await post(`/api/v1/uploads/${attachment.id}/complete`);
      expect(segunda.statusCode).toBe(200);
      await t.app.services.videoProcessor.ocioso();
      expect(t.transcoder.convertidos.length - antes).toBe(1);
    });

    it('vídeo que o conversor não consegue ler vira FAILED, e o original sai do disco', async () => {
      const order = await novaOS();
      t.transcoder.falhar = true;
      try {
        const video = await gravar(order.id);
        expect(video).toMatchObject({ status: 'FAILED', url: null, downloadUrl: null });
        expect([...t.storage.objects.keys()].some((chave) => chave.includes(video.id))).toBe(false);
      } finally {
        t.transcoder.falhar = false;
      }
    });

    it('recusa vídeo maior que o teto já no ticket', async () => {
      const order = await novaOS();
      const res = await ticket(order.id, { sizeBytes: 600 * 1024 * 1024 });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('Vídeo grande demais');
    });

    it('recusa item de outra OS', async () => {
      const order = await novaOS();
      const outra = await novaOS();
      const itemDaOutra = (await get(`/api/v1/work-orders/${outra.number}`)).json().items[0].id as string;
      const res = await ticket(order.id, { workOrderItemId: itemDaOutra });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('não é desta OS');
    });

    it('formato que não é vídeo não passa pela rota de vídeo', async () => {
      const order = await novaOS();
      expect((await ticket(order.id, { mimeType: 'image/jpeg' })).statusCode).toBe(400);
    });
  });

  describe('o envio em fluxo', () => {
    it('o link de FOTO não aceita fluxo de vídeo (não vira porta para 500 MB)', async () => {
      const order = await novaOS();
      const foto = await post('/api/v1/uploads', { kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 10, workOrderId: order.id });
      const res = await send(foto.json().uploadUrl, VIDEO, 'video/mp4');
      expect(res.statusCode).toBe(415);
    });

    it('no disco de verdade: passou do teto, para no meio e não deixa pedaço de arquivo', async () => {
      const pasta = mkdtempSync(join(tmpdir(), 'oficinaos-fluxo-'));
      try {
        const disco = new DiskStorageProvider('segredo', pasta);
        const partes = Readable.from([Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)]);
        await expect(disco.putStream('videos/x.original', partes, 'video/mp4', 20)).rejects.toBeInstanceOf(ObjectTooLargeError);
        expect(existsSync(disco.localPath('videos/x.original'))).toBe(false);
        expect(await disco.head('videos/x.original')).toBeNull();

        // dentro do teto: grava e devolve o tamanho
        const cabe = Readable.from([Buffer.alloc(8), Buffer.alloc(8)]);
        expect(await disco.putStream('videos/y.original', cabe, 'video/mp4', 20)).toBe(16);
        expect(await disco.head('videos/y.original')).toEqual({ sizeBytes: 16, mimeType: 'video/mp4' });
        const pedaco = await disco.stream('videos/y.original', { start: 2, end: 5 });
        const lidos: Buffer[] = [];
        for await (const parte of pedaco!.body) lidos.push(parte as Buffer);
        expect(Buffer.concat(lidos).byteLength).toBe(4);
      } finally {
        rmSync(pasta, { recursive: true, force: true });
      }
    });

    it('passou do teto no meio do envio: 413 e nada fica gravado', async () => {
      const pequeno = await createTestApp({ VIDEO_UPLOAD_MAX_BYTES: '20' });
      try {
        const dono = await signup(pequeno.app);
        const customer = await createCustomer(pequeno.app, dono);
        const vehicle = await createVehicle(pequeno.app, dono, customer.id);
        const order = await createWorkOrder(pequeno.app, dono, { customerId: customer.id, vehicleId: vehicle.id });
        // o ticket confia no tamanho declarado; quem garante é a contagem no envio
        const criado = await pequeno.app.inject({
          method: 'POST',
          url: '/api/v1/uploads/videos',
          headers: bearer(dono.accessToken),
          payload: { mimeType: 'video/mp4', sizeBytes: 10, workOrderId: order.id },
        });
        expect(criado.statusCode, criado.body).toBe(201);
        const res = await pequeno.app.inject({
          method: 'PUT',
          url: criado.json().uploadUrl,
          headers: { 'content-type': 'video/mp4' },
          payload: VIDEO,
        });
        expect(res.statusCode).toBe(413);
        expect(pequeno.storage.objects.size).toBe(0);
      } finally {
        await pequeno.app.close();
      }
    });
  });

  describe('tocar em qualquer aparelho (Range) e baixar', () => {
    it('responde 206 ao pedaço que o Safari do iPhone pede primeiro', async () => {
      const order = await novaOS();
      const video = await gravar(order.id);
      const res = await t.app.inject({ method: 'GET', url: video.url!, headers: { range: 'bytes=0-1' } });
      expect(res.statusCode).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 0-1/${VIDEO.byteLength}`);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toContain('video/mp4');
      expect(res.rawPayload.equals(VIDEO.subarray(0, 2))).toBe(true);

      const resto = await t.app.inject({ method: 'GET', url: video.url!, headers: { range: 'bytes=10-' } });
      expect(resto.statusCode).toBe(206);
      expect(resto.rawPayload.equals(VIDEO.subarray(10))).toBe(true);

      const fora = await t.app.inject({ method: 'GET', url: video.url!, headers: { range: `bytes=${VIDEO.byteLength}-` } });
      expect(fora.statusCode).toBe(416);
      expect(fora.headers['content-range']).toBe(`bytes */${VIDEO.byteLength}`);

      const inteiro = await t.app.inject({ method: 'GET', url: video.url! });
      expect(inteiro.statusCode).toBe(200);
      expect(inteiro.headers['content-length']).toBe(String(VIDEO.byteLength));
      expect(inteiro.headers['content-disposition']).toBeUndefined();
    });

    it('o link de baixar responde como anexo, com nome de arquivo', async () => {
      const order = await novaOS();
      const video = await gravar(order.id);
      const res = await t.app.inject({ method: 'GET', url: video.downloadUrl! });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="video-oficina-[\w-]+\.mp4"$/);
    });

    it('lerRange: os formatos que os navegadores mandam', () => {
      expect(lerRange(undefined, 100)).toBeNull();
      expect(lerRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
      expect(lerRange('bytes=50-', 100)).toEqual({ start: 50, end: 99 });
      expect(lerRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
      expect(lerRange('bytes=0-999', 100)).toEqual({ start: 0, end: 99 });
      expect(lerRange('bytes=100-', 100)).toBe('invalido');
      expect(lerRange('bytes=5-2', 100)).toBe('invalido');
      // vários pedaços: responde inteiro (nenhum navegador pede isso para vídeo)
      expect(lerRange('bytes=0-1,5-6', 100)).toBeNull();
    });

    it('duracaoDaSaida: o último time= do ffmpeg, até 60 s', () => {
      const progresso = 'Duration: 00:01:12.30\rframe= 10 time=00:00:05.10 \rframe= 900 time=00:00:59.93 bitrate=';
      expect(duracaoDaSaida(progresso)).toBe(60);
      expect(duracaoDaSaida('time=00:00:12.40')).toBe(12);
      expect(duracaoDaSaida('sem progresso')).toBe(0);
    });
  });

  describe('no orçamento', () => {
    const publicGet = (token: string) =>
      t.app.inject({ method: 'GET', url: `/api/v1/public/quotes/${token}`, remoteAddress: nextIp() });
    const publicPost = (token: string, action: string, payload: Record<string, unknown>) =>
      t.app.inject({ method: 'POST', url: `/api/v1/public/quotes/${token}/${action}`, remoteAddress: nextIp(), payload });

    async function enviarOrcamento(workOrderId: string) {
      const quote = await post(`/api/v1/work-orders/${workOrderId}/quotes`, {});
      expect(quote.statusCode, quote.body).toBe(201);
      const token = (quote.json().publicUrl as string).split('/').pop()!;
      return { quote: quote.json() as { id: string; number: number }, token };
    }

    it('vai para o cliente com o item de que fala, e não aparece como foto', async () => {
      const order = await novaOS();
      const itemId = (await get(`/api/v1/work-orders/${order.number}`)).json().items[0].id as string;
      const video = await gravar(order.id, { workOrderItemId: itemId, caption: 'Pastilha no fim' });
      const { token } = await enviarOrcamento(order.id);

      const publico = (await publicGet(token)).json();
      expect(publico.videos).toHaveLength(1);
      expect(publico.videos[0]).toMatchObject({
        id: video.id,
        itemDescription: 'Troca de pastilhas',
        expiresAt: null,
        expired: false,
      });
      expect(publico.videos[0].url).toContain('/api/v1/uploads/object?');
      expect(publico.videos[0].downloadUrl).toMatch(/download=1&n=video-orcamento-\d+-1\.mp4$/);
      // a foto do item é <img>: um vídeo ali seria um quadro quebrado
      expect(publico.items[0].photos).toEqual([]);
    });

    it('vídeo ainda convertendo vai junto e aparece quando fica pronto', async () => {
      const order = await novaOS();
      const { attachment, uploadUrl } = (await ticket(order.id)).json();
      await send(uploadUrl);
      const soltar = t.transcoder.segurar();
      await post(`/api/v1/uploads/${attachment.id}/complete`);
      // o orçamento sai ANTES da conversão terminar
      expect((await anexos(order.id))[0]!.status).toBe('PROCESSING');
      const { token } = await enviarOrcamento(order.id);
      expect((await publicGet(token)).json().videos).toEqual([]);
      soltar();
      await t.app.services.videoProcessor.ocioso();
      const publico = (await publicGet(token)).json();
      expect(publico.videos.map((v: TestPublicVideo) => v.id)).toEqual([attachment.id]);
    });

    it('vídeo que a oficina desmarcou para o cliente não vai', async () => {
      const order = await novaOS();
      await gravar(order.id, { visibleToCustomer: false });
      const { token } = await enviarOrcamento(order.id);
      expect((await publicGet(token)).json().videos).toEqual([]);
    });

    it('a aprovação começa o prazo de 7 dias, contado da resposta', async () => {
      const order = await novaOS();
      const video = await gravar(order.id);
      const { token } = await enviarOrcamento(order.id);
      const publico = (await publicGet(token)).json();
      const aprovado = await publicPost(token, 'approve', {
        approvedItemIds: publico.items.map((item: { id: string }) => item.id),
        signerName: 'Maria Souza',
        accepted: true,
        contentHash: publico.contentHash,
      });
      expect(aprovado.statusCode, aprovado.body).toBe(200);
      const respondidoEm = Date.parse(aprovado.json().decision.decidedAt);

      const [naOficina] = await anexos(order.id);
      expect(naOficina!.id).toBe(video.id);
      expect(Math.abs(Date.parse(naOficina!.expiresAt!) - (respondidoEm + 7 * DIA_MS))).toBeLessThan(5_000);
      expect(aprovado.json().videos[0].expiresAt).toBe(naOficina!.expiresAt);
    });

    it('a recusa também começa o prazo', async () => {
      const order = await novaOS();
      await gravar(order.id);
      const { token } = await enviarOrcamento(order.id);
      const publico = (await publicGet(token)).json();
      const recusado = await publicPost(token, 'reject', { reason: 'Vou pensar', contentHash: publico.contentHash });
      expect(recusado.statusCode, recusado.body).toBe(200);
      expect(recusado.json().videos[0].expiresAt).not.toBeNull();
    });

    it('a decisão registrada pela oficina (telefone) também começa o prazo', async () => {
      const order = await novaOS();
      await gravar(order.id);
      const { quote } = await enviarOrcamento(order.id);
      const res = await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
      expect(res.statusCode, res.body).toBe(200);
      expect((await anexos(order.id))[0]!.expiresAt).not.toBeNull();
    });

    it('vídeo que já tem prazo não ganha mais tempo num orçamento complementar', async () => {
      const order = await novaOS();
      await gravar(order.id);
      const { quote } = await enviarOrcamento(order.id);
      await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
      const prazo = (await anexos(order.id))[0]!.expiresAt;

      // uma segunda resposta com o mesmo vídeo (o complementar), 3 dias depois
      const { marcarPrazoDosVideos } = await import('../src/modules/uploads/videos.service');
      await withTenant(testDb().db, { organizationId: owner.orgId }, (tx) =>
        marcarPrazoDosVideos(tx, owner.orgId, quote.id, new Date(Date.now() + 3 * DIA_MS)),
      );
      expect((await anexos(order.id))[0]!.expiresAt).toBe(prazo);
    });
  });

  describe('a limpeza de hora em hora', () => {
    const limpar = (agora?: Date) => t.app.services.videos.apagarVencidos(owner.orgId, agora);

    it('7 dias depois da resposta o arquivo sai do disco; o cliente vê até quando ficou', async () => {
      const order = await novaOS();
      const video = await gravar(order.id);
      const quote = await post(`/api/v1/work-orders/${order.id}/quotes`, {});
      const token = (quote.json().publicUrl as string).split('/').pop()!;
      await post(`/api/v1/quotes/${quote.json().id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
      const prazo = Date.parse((await anexos(order.id))[0]!.expiresAt!);

      // um minuto antes do prazo: continua
      await limpar(new Date(prazo - 60_000));
      expect((await anexos(order.id))[0]!.status).toBe('READY');

      // passou do prazo: sai
      await limpar(new Date(prazo + 60_000));
      const [depois] = await anexos(order.id);
      expect(depois).toMatchObject({ status: 'EXPIRED', url: null, downloadUrl: null, posterUrl: null });
      expect([...t.storage.objects.keys()].some((chave) => chave.includes(video.id))).toBe(false);

      const publico = (
        await t.app.inject({ method: 'GET', url: `/api/v1/public/quotes/${token}`, remoteAddress: nextIp() })
      ).json();
      expect(publico.videos[0]).toMatchObject({ id: video.id, url: null, downloadUrl: null, expired: true });
      expect(publico.videos[0].expiresAt).not.toBeNull();
    });

    it('sem resposta nenhuma, o vídeo sai em 30 dias (e não antes)', async () => {
      const order = await novaOS();
      const video = await gravar(order.id);
      await sqlNaOficina(sql`update attachments set created_at = now() - interval '29 days' where id = ${video.id}`);
      await limpar();
      expect((await anexos(order.id))[0]!.status).toBe('READY');

      await sqlNaOficina(sql`update attachments set created_at = now() - interval '31 days' where id = ${video.id}`);
      await limpar();
      expect((await anexos(order.id))[0]!.status).toBe('EXPIRED');
    });

    it('o envio que começou e nunca terminou sai depois de um dia', async () => {
      const order = await novaOS();
      const { attachment, uploadUrl } = (await ticket(order.id)).json();
      await send(uploadUrl);
      await sqlNaOficina(sql`update attachments set created_at = now() - interval '2 days' where id = ${attachment.id}`);
      await limpar();
      expect([...t.storage.objects.keys()].some((chave) => chave.includes(attachment.id))).toBe(false);
      const { rows } = await sqlNaOficina(sql`select status from attachments where id = ${attachment.id}`);
      expect(rows[0]).toMatchObject({ status: 'EXPIRED' });
    });

    it('a volta das automações chama a limpeza', async () => {
      const order = await novaOS();
      const video = await gravar(order.id);
      await sqlNaOficina(sql`update attachments set expires_at = now() - interval '1 minute' where id = ${video.id}`);
      await t.app.services.automations.tick(owner.orgId);
      expect((await anexos(order.id))[0]!.status).toBe('EXPIRED');
    });

    it('apagar o vídeo libera o disco na hora e tira ele do orçamento', async () => {
      const order = await novaOS();
      const video = await gravar(order.id);
      const quote = await post(`/api/v1/work-orders/${order.id}/quotes`, {});
      const token = (quote.json().publicUrl as string).split('/').pop()!;

      const res = await t.app.inject({ method: 'DELETE', url: `/api/v1/uploads/${video.id}`, headers: bearer(owner.accessToken) });
      expect(res.statusCode).toBe(204);
      expect([...t.storage.objects.keys()].some((chave) => chave.includes(video.id))).toBe(false);
      const publico = (
        await t.app.inject({ method: 'GET', url: `/api/v1/public/quotes/${token}`, remoteAddress: nextIp() })
      ).json();
      expect(publico.videos).toEqual([]);
    });
  });

  describe('plano', () => {
    async function noPlano(code: 'TURBO' | 'SUPERCHARGER') {
      const dono = await signup(t.app);
      await withTenant(testDb().db, { organizationId: dono.orgId }, (tx) =>
        tx.execute(sql`update subscriptions set plan_id = (select id from plans where code = ${code}) where organization_id = ${dono.orgId}`),
      );
      t.app.caches.subscriptions.delete(dono.orgId);
      return dono;
    }

    it('o Turbo não grava vídeo: 402 dizendo em qual plano ele mora', async () => {
      const dono = await noPlano('TURBO');
      const order = await novaOS(dono);
      const res = await ticket(order.id, {}, dono);
      expect(res.statusCode).toBe(402);
      expect(res.json()).toMatchObject({ code: 'PLAN_FEATURE_REQUIRED', meta: { requiredPlan: 'SUPERCHARGER' } });
    });

    it('o Supercharger grava', async () => {
      const dono = await noPlano('SUPERCHARGER');
      const order = await novaOS(dono);
      expect((await ticket(order.id, {}, dono)).statusCode).toBe(201);
    });
  });
});
