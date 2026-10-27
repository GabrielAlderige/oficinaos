import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app';
import { MemoryEmailProvider } from '../src/integrations/email/email';
import { copiarDoDisco } from '../src/integrations/storage/mudar-de-lugar';
import { DiskStorageProvider, ObjectTooLargeError, S3StorageProvider, type S3Config } from '../src/integrations/storage/storage';
import { FakeVideoTranscoder, FfmpegTranscoder } from '../src/integrations/video/transcoder';
import { bearer, createCustomer, createVehicle, createWorkOrder, signup, testDb, testEnv, type TestSession } from './helpers';

/**
 * O driver S3 (Cloudflare R2 em produção) contra um servidor S3 de verdade.
 * Precisa de um: `S3_TEST_ENDPOINT=http://127.0.0.1:5055` (o moto serve:
 * `moto_server -p 5055`), com chaves quaisquer. Sem ele o teste é pulado e diz
 * por quê. Cada rodada usa um balde novo.
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
const config: S3Config = {
  endpoint: endpoint ?? '',
  region: 'auto',
  bucket: `oficinaos-teste-${Date.now()}`,
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? 'teste',
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'teste',
};
const SECRET = 'segredo-de-teste-com-bem-mais-de-32-caracteres';

/** Fluxo que entrega o buffer em pedaços, como a conexão do celular. */
function emPedacos(dados: Buffer, tamanho = 256 * 1024): Readable {
  const pedacos: Buffer[] = [];
  for (let i = 0; i < dados.byteLength; i += tamanho) pedacos.push(dados.subarray(i, i + tamanho));
  return Readable.from(pedacos);
}

async function lerTudo(fluxo: Readable): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const parte of fluxo) partes.push(Buffer.from(parte as Uint8Array));
  return Buffer.concat(partes);
}

describe.skipIf(!endpoint)('storage no S3/R2 (S3_TEST_ENDPOINT)', () => {
  let storage: S3StorageProvider;

  beforeAll(async () => {
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    if (!process.env.S3_TEST_BUCKET) await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    else config.bucket = process.env.S3_TEST_BUCKET;
    storage = new S3StorageProvider(SECRET, config);
  });

  describe('o driver', () => {
    it('grava, informa tamanho e tipo, lê e apaga', async () => {
      const body = Buffer.from('conteúdo da foto');
      await storage.put('org/os/foto.jpg', body, 'image/jpeg');

      expect(await storage.head('org/os/foto.jpg')).toEqual({ sizeBytes: body.byteLength, mimeType: 'image/jpeg' });
      expect((await storage.get('org/os/foto.jpg'))?.body.equals(body)).toBe(true);

      await storage.remove('org/os/foto.jpg');
      expect(await storage.head('org/os/foto.jpg')).toBeNull();
    });

    it('arquivo que não existe devolve null nas três leituras, não erro', async () => {
      expect(await storage.head('org/nao-existe.jpg')).toBeNull();
      expect(await storage.get('org/nao-existe.jpg')).toBeNull();
      expect(await storage.stream('org/nao-existe.jpg')).toBeNull();
      // apagar o que já não existe também não é erro (a limpeza roda de novo)
      await expect(storage.remove('org/nao-existe.jpg')).resolves.toBeUndefined();
    });

    it('pedaço do vídeo (Range): só os bytes pedidos, e o tamanho TOTAL do arquivo', async () => {
      const video = randomBytes(300_000);
      await storage.put('videos/range.mp4', video, 'video/mp4');

      const pedaco = await storage.stream('videos/range.mp4', { start: 1000, end: 1999 });
      expect(pedaco!.info).toEqual({ sizeBytes: 300_000, mimeType: 'video/mp4' });
      expect((await lerTudo(pedaco!.body)).equals(video.subarray(1000, 2000))).toBe(true);

      const inteiro = await storage.stream('videos/range.mp4');
      expect(inteiro!.info.sizeBytes).toBe(300_000);
      expect((await lerTudo(inteiro!.body)).equals(video)).toBe(true);
    });

    it('envio em fluxo pequeno: grava inteiro e devolve o tamanho', async () => {
      const video = randomBytes(700_000);
      expect(await storage.putStream('videos/curto.mov', emPedacos(video), 'video/quicktime', 10_000_000)).toBe(700_000);
      expect((await storage.get('videos/curto.mov'))?.body.equals(video)).toBe(true);
      expect(await storage.head('videos/curto.mov')).toEqual({ sizeBytes: 700_000, mimeType: 'video/quicktime' });
    });

    it('envio em fluxo grande (em partes, como um vídeo de 60 s): nenhum byte perdido ou trocado', async () => {
      const video = randomBytes(13 * 1024 * 1024);
      expect(await storage.putStream('videos/longo.mov', emPedacos(video), 'video/quicktime', 50 * 1024 * 1024)).toBe(
        video.byteLength,
      );
      expect((await storage.get('videos/longo.mov'))?.body.equals(video)).toBe(true);
    }, 60_000);

    it('passou do teto no meio do envio: para, avisa e não deixa pedaço no balde', async () => {
      const video = randomBytes(7 * 1024 * 1024);
      await expect(storage.putStream('videos/grande.mov', emPedacos(video), 'video/quicktime', 6 * 1024 * 1024)).rejects.toBeInstanceOf(
        ObjectTooLargeError,
      );
      expect(await storage.head('videos/grande.mov')).toBeNull();
    }, 60_000);

    it('conexão caída no meio do envio: falha e não deixa pedaço no balde', async () => {
      const caiu = new Readable({
        read() {
          this.push(randomBytes(64 * 1024));
          this.destroy(new Error('a conexão do celular caiu'));
        },
      });
      await expect(storage.putStream('videos/caiu.mov', caiu, 'video/quicktime', 50_000_000)).rejects.toThrow(/caiu/);
      expect(await storage.head('videos/caiu.mov')).toBeNull();
    });
  });

  describe('a mudança do disco para o balde', () => {
    it('copia tudo com o tipo certo, confere, pula o que já foi e não apaga o disco', async () => {
      const pasta = mkdtempSync(join(tmpdir(), 'oficinaos-mudanca-'));
      try {
        const disco = new DiskStorageProvider(SECRET, pasta);
        const foto = randomBytes(40_000);
        const video = randomBytes(900_000);
        await disco.put('org-a/os-1/foto.jpg', foto, 'image/jpeg');
        await disco.put('videos/org-a/os-1/v.mp4', video, 'video/mp4');
        // envio que caiu no meio: arquivo sem o .meta, de anexo nenhum
        writeFileSync(join(pasta, 'org-a', 'os-1', 'pela-metade.jpg'), 'xx');
        const balde = new S3StorageProvider(SECRET, { ...config });

        const primeira = await copiarDoDisco(disco, pasta, balde);
        expect(primeira).toMatchObject({ copiados: 2, jaEstavam: 0, bytes: 940_000 });
        expect(primeira.falhas).toEqual([{ chave: 'org-a/os-1/pela-metade.jpg', motivo: expect.stringContaining('.meta') }]);
        expect(await balde.head('org-a/os-1/foto.jpg')).toEqual({ sizeBytes: 40_000, mimeType: 'image/jpeg' });
        expect((await balde.get('videos/org-a/os-1/v.mp4'))?.body.equals(video)).toBe(true);
        expect(await disco.head('org-a/os-1/foto.jpg')).not.toBeNull();

        // rodar de novo (a mudança caiu no meio, ou por garantia) não copia de novo
        const segunda = await copiarDoDisco(disco, pasta, balde);
        expect(segunda).toMatchObject({ copiados: 0, jaEstavam: 2 });

        // o arquivo que mudou no disco depois da primeira cópia vai de novo
        await disco.put('org-a/os-1/foto.jpg', randomBytes(41_000), 'image/jpeg');
        expect(await copiarDoDisco(disco, pasta, balde)).toMatchObject({ copiados: 1, jaEstavam: 1 });
        expect((await balde.head('org-a/os-1/foto.jpg'))?.sizeBytes).toBe(41_000);
      } finally {
        rmSync(pasta, { recursive: true, force: true });
      }
    });
  });

  describe('pela API', () => {
    let app: App;
    let owner: TestSession;

    beforeAll(async () => {
      const env = testEnv();
      app = await buildApp({
        env,
        db: testDb().db,
        email: new MemoryEmailProvider(),
        storage: new S3StorageProvider(env.JWT_SECRET, config),
        transcoder: new FakeVideoTranscoder(),
      });
      await app.ready();
      owner = await signup(app);
    });
    afterAll(async () => {
      await app.close();
    });

    it('o vídeo do defeito: envio em fluxo, conversão, e o celular lê aos pedaços', async () => {
      const customer = await createCustomer(app, owner, { name: 'Maria Souza', whatsapp: '(11) 91234-5678' });
      const vehicle = await createVehicle(app, owner, customer.id, { plate: 'RRS3A01' });
      const order = (await createWorkOrder(app, owner, { customerId: customer.id, vehicleId: vehicle.id, items: [] })) as { id: string };

      const video = randomBytes(2 * 1024 * 1024);
      const ticket = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads/videos',
        headers: bearer(owner.accessToken),
        payload: { mimeType: 'video/quicktime', sizeBytes: video.byteLength, workOrderId: order.id },
      });
      expect(ticket.statusCode, ticket.body).toBe(201);
      const { attachment, uploadUrl } = ticket.json();
      const envio = await app.inject({ method: 'PUT', url: uploadUrl, headers: { 'content-type': 'video/quicktime' }, payload: video });
      expect(envio.statusCode, envio.body).toBe(204);
      const conferido = await app.inject({ method: 'POST', url: `/api/v1/uploads/${attachment.id}/complete`, headers: bearer(owner.accessToken), payload: {} });
      expect(conferido.statusCode, conferido.body).toBe(200);
      await app.services.videoProcessor.ocioso();

      const anexos = (
        await app.inject({ method: 'GET', url: `/api/v1/work-orders/${order.id}/attachments`, headers: bearer(owner.accessToken) })
      ).json().data as { id: string; status: string; url: string }[];
      const pronto = anexos.find((anexo) => anexo.id === attachment.id)!;
      expect(pronto.status).toBe('READY');

      // o Safari do iPhone pede o vídeo aos pedaços: sem 206 certo, ele não toca
      const pedaco = await app.inject({ method: 'GET', url: pronto.url, headers: { range: 'bytes=100-199' } });
      expect(pedaco.statusCode).toBe(206);
      expect(pedaco.headers['content-range']).toBe(`bytes 100-199/${video.byteLength}`);
      expect(pedaco.headers['content-type']).toBe('video/mp4');
      expect(pedaco.rawPayload.equals(video.subarray(100, 200))).toBe(true);

      const inteiro = await app.inject({ method: 'GET', url: pronto.url });
      expect(inteiro.statusCode).toBe(200);
      expect(inteiro.rawPayload.equals(video)).toBe(true);
    });
  });

  // com um ffmpeg também, a conversão de verdade lendo e gravando no balde
  // (no disco local o ffmpeg lia o original direto; aqui ele baixa antes)
  describe.skipIf(!process.env.FFMPEG_TEST_PATH)('conversão de verdade com o original no balde', () => {
    it('baixa o original, converte e grava o MP4 e a capa no balde', async () => {
      const pasta = mkdtempSync(join(tmpdir(), 'oficinaos-s3-ffmpeg-'));
      try {
        const original = join(pasta, 'original.webm');
        execFileSync(process.env.FFMPEG_TEST_PATH!, [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10', '-t', '3', '-c:v', 'libvpx', '-f', 'webm', original,
        ]);
        await storage.put('videos/conv.original', readFileSync(original), 'video/webm');
        const resultado = await new FfmpegTranscoder(process.env.FFMPEG_TEST_PATH!).transcode({
          storage,
          sourceKey: 'videos/conv.original',
          videoKey: 'videos/conv.mp4',
          posterKey: 'videos/conv.jpg',
        });
        expect(resultado.durationSeconds).toBe(3);
        expect(await storage.head('videos/conv.mp4')).toEqual({ sizeBytes: resultado.sizeBytes, mimeType: 'video/mp4' });
        expect(await storage.head('videos/conv.jpg')).toMatchObject({ mimeType: 'image/jpeg' });
      } finally {
        rmSync(pasta, { recursive: true, force: true });
      }
    }, 60_000);
  });
});

describe.skipIf(Boolean(endpoint))('storage no S3/R2', () => {
  it.skip('pulado: defina S3_TEST_ENDPOINT para rodar contra um S3 de verdade (moto_server -p 5055)', () => {});
});
