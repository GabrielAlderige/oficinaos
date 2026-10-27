import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Env } from '../../config/env';

export interface ObjectInfo {
  sizeBytes: number;
  mimeType: string;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

export type StorageAction = 'put' | 'get';

/** Pedaço do arquivo, com as duas pontas incluídas (como no cabeçalho Range). */
export interface ByteRange {
  start: number;
  end: number;
}

/** O envio em fluxo passou do teto: nada fica gravado. */
export class ObjectTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Arquivo maior que ${maxBytes} bytes`);
  }
}

/**
 * Armazenamento de fotos e anexos atrás de uma interface (ARCHITECTURE §11 e §12).
 * O domínio conhece a interface, nunca o fornecedor: trocar disco por S3/R2 no
 * deploy não mexe em módulo nenhum.
 *
 * O navegador nunca recebe uma chave crua: recebe uma URL **assinada e com
 * validade curta**, servida pela própria API (mesma origem do painel, então
 * serve direto em `<img src>`).
 */
export interface StorageProvider {
  readonly driver: string;
  /** URL de envio (PUT) para o navegador mandar o arquivo. */
  signUpload(key: string, expiresInSeconds?: number): SignedUrl;
  /** URL de leitura (GET), a que vai no `<img src>`. */
  signDownload(key: string, expiresInSeconds?: number): SignedUrl;
  /** Confere assinatura e validade. A rota do objeto chama isto antes de tudo. */
  verify(input: { key: string; action: StorageAction; expires: number; signature: string }): boolean;
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  /**
   * Grava sem passar o arquivo inteiro pela memória (vídeo, E45). Passou de
   * `maxBytes`, para no meio, apaga o pedaço e lança `ObjectTooLargeError`.
   * Devolve o tamanho gravado.
   */
  putStream(key: string, body: Readable, mimeType: string, maxBytes: number): Promise<number>;
  get(key: string): Promise<{ body: Buffer; info: ObjectInfo } | null>;
  /** Leitura em fluxo, inteira ou um pedaço: é o que o Range do vídeo precisa. */
  stream(key: string, range?: ByteRange): Promise<{ body: Readable; info: ObjectInfo } | null>;
  head(key: string): Promise<ObjectInfo | null>;
  remove(key: string): Promise<void>;
  /** Caminho no disco, para o ffmpeg; `null` quando o objeto não mora num disco local. */
  localPath(key: string): string | null;
}

/** Conta os bytes que passam e corta quando passam do teto. */
function limitador(maxBytes: number, aoContar?: (total: number) => void): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.byteLength;
      aoContar?.(total);
      if (total > maxBytes) done(new ObjectTooLargeError(maxBytes));
      else done(null, chunk);
    },
  });
}

/** 5 minutos para enviar, 1 hora para ler (o painel renova ao recarregar). */
const UPLOAD_TTL = 5 * 60;
const DOWNLOAD_TTL = 60 * 60;

/**
 * A assinatura é derivada do JWT_SECRET com um contexto próprio: uma URL de
 * arquivo nunca pode ser confundida com um token de sessão.
 */
const CONTEXT = 'oficinaos:storage:v1';

const base64url = (value: Buffer) => value.toString('base64url');

abstract class SignedStorage implements StorageProvider {
  abstract readonly driver: string;

  constructor(private readonly secret: string) {}

  private sign(action: StorageAction, key: string, expires: number): string {
    return base64url(createHmac('sha256', `${CONTEXT}:${this.secret}`).update(`${action}\n${key}\n${expires}`).digest());
  }

  private url(action: StorageAction, key: string, ttl: number): SignedUrl {
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const params = new URLSearchParams({
      k: Buffer.from(key).toString('base64url'),
      a: action,
      e: String(expires),
      s: this.sign(action, key, expires),
    });
    return { url: `/api/v1/uploads/object?${params.toString()}`, expiresAt: new Date(expires * 1000) };
  }

  signUpload(key: string, expiresInSeconds = UPLOAD_TTL): SignedUrl {
    return this.url('put', key, expiresInSeconds);
  }

  signDownload(key: string, expiresInSeconds = DOWNLOAD_TTL): SignedUrl {
    return this.url('get', key, expiresInSeconds);
  }

  verify({ key, action, expires, signature }: { key: string; action: StorageAction; expires: number; signature: string }): boolean {
    if (!Number.isSafeInteger(expires) || expires * 1000 < Date.now()) return false;
    const expected = Buffer.from(this.sign(action, key, expires));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  abstract put(key: string, body: Buffer, mimeType: string): Promise<void>;
  abstract putStream(key: string, body: Readable, mimeType: string, maxBytes: number): Promise<number>;
  abstract get(key: string): Promise<{ body: Buffer; info: ObjectInfo } | null>;
  abstract stream(key: string, range?: ByteRange): Promise<{ body: Readable; info: ObjectInfo } | null>;
  abstract head(key: string): Promise<ObjectInfo | null>;
  abstract remove(key: string): Promise<void>;
  abstract localPath(key: string): string | null;
}

/**
 * Driver de desenvolvimento: grava numa pasta local, fora do git. O tipo do
 * arquivo vai num arquivo `.meta` ao lado, para que a conferência do §11
 * (tamanho **e** tipo) seja real e não confie no que o front declarou.
 */
export class DiskStorageProvider extends SignedStorage {
  readonly driver = 'disk';

  constructor(
    secret: string,
    private readonly baseDir: string,
  ) {
    super(secret);
  }

  /** Nenhuma chave pode escapar da pasta base (`..`, caminho absoluto). */
  private pathOf(key: string): string {
    const base = resolve(this.baseDir);
    const full = resolve(join(base, key));
    if (full !== base && !full.startsWith(base + sep)) throw new Error(`Chave de storage inválida: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer, mimeType: string): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(`${path}.meta`, JSON.stringify({ mimeType }), 'utf8');
  }

  async putStream(key: string, body: Readable, mimeType: string, maxBytes: number): Promise<number> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await pipeline(body, limitador(maxBytes), createWriteStream(path));
    } catch (erro) {
      // envio cortado (teto ou conexão caída): pedaço de arquivo não fica no disco
      await rm(path, { force: true });
      throw erro;
    }
    await writeFile(`${path}.meta`, JSON.stringify({ mimeType }), 'utf8');
    return (await stat(path)).size;
  }

  async get(key: string): Promise<{ body: Buffer; info: ObjectInfo } | null> {
    const info = await this.head(key);
    if (!info) return null;
    return { body: await readFile(this.pathOf(key)), info };
  }

  async stream(key: string, range?: ByteRange): Promise<{ body: Readable; info: ObjectInfo } | null> {
    const info = await this.head(key);
    if (!info) return null;
    return { body: createReadStream(this.pathOf(key), range), info };
  }

  localPath(key: string): string {
    return this.pathOf(key);
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const path = this.pathOf(key);
    try {
      const stats = await stat(path);
      const meta = JSON.parse(await readFile(`${path}.meta`, 'utf8')) as { mimeType?: string };
      return { sizeBytes: stats.size, mimeType: meta.mimeType ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    const path = this.pathOf(key);
    await rm(path, { force: true });
    await rm(`${path}.meta`, { force: true });
  }
}

/** Driver dos testes: nada toca o disco. */
export class MemoryStorageProvider extends SignedStorage {
  readonly driver = 'memory';
  readonly objects = new Map<string, { body: Buffer; info: ObjectInfo }>();

  async put(key: string, body: Buffer, mimeType: string): Promise<void> {
    this.objects.set(key, { body, info: { sizeBytes: body.byteLength, mimeType } });
  }

  async putStream(key: string, body: Readable, mimeType: string, maxBytes: number): Promise<number> {
    const partes: Buffer[] = [];
    let total = 0;
    for await (const parte of body) {
      const chunk = Buffer.isBuffer(parte) ? parte : Buffer.from(parte as Uint8Array);
      total += chunk.byteLength;
      if (total > maxBytes) throw new ObjectTooLargeError(maxBytes);
      partes.push(chunk);
    }
    await this.put(key, Buffer.concat(partes), mimeType);
    return total;
  }

  async get(key: string): Promise<{ body: Buffer; info: ObjectInfo } | null> {
    return this.objects.get(key) ?? null;
  }

  async stream(key: string, range?: ByteRange): Promise<{ body: Readable; info: ObjectInfo } | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    const pedaco = range ? object.body.subarray(range.start, range.end + 1) : object.body;
    return { body: Readable.from([pedaco]), info: object.info };
  }

  localPath(): null {
    return null;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    return this.objects.get(key)?.info ?? null;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** "não existe" no S3: 404 no HEAD, NoSuchKey no GET. */
function naoExiste(erro: unknown): boolean {
  return (
    erro instanceof S3ServiceException &&
    (erro.name === 'NotFound' || erro.name === 'NoSuchKey' || erro.$metadata.httpStatusCode === 404)
  );
}

/**
 * Produção: balde S3 compatível (Cloudflare R2). As URLs continuam sendo as da
 * API, assinadas por ela: o balde é privado, o navegador nunca fala com ele e
 * as chaves dele nunca saem do servidor. O tipo do arquivo é o Content-Type do
 * próprio objeto (no disco era o `.meta`).
 */
export class S3StorageProvider extends SignedStorage {
  readonly driver = 's3';
  private readonly client: S3Client;

  constructor(
    secret: string,
    private readonly config: S3Config,
  ) {
    super(secret);
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // o endereço do balde vai no caminho, não no subdomínio (R2 e servidores locais)
      forcePathStyle: true,
      // conferência de CRC só quando a operação exige: o R2 não aceita todas
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private get bucket(): string {
    return this.config.bucket;
  }

  async put(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mimeType }));
  }

  async putStream(key: string, body: Readable, mimeType: string, maxBytes: number): Promise<number> {
    let total = 0;
    const contado = body.pipe(limitador(maxBytes, (atual) => (total = atual)));
    // conexão caída no meio: o erro chega ao envio para ele parar
    body.on('error', (erro) => contado.destroy(erro));
    const envio = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: contado, ContentType: mimeType },
      queueSize: 2,
    });
    try {
      await envio.done();
    } catch (erro) {
      // envio cortado: o Upload desfaz a parte em pedaços; um envio simples pode ter gravado
      await envio.abort().catch(() => {});
      await this.remove(key).catch(() => {});
      throw contado.errored ?? erro;
    }
    return total;
  }

  async get(key: string): Promise<{ body: Buffer; info: ObjectInfo } | null> {
    const objeto = await this.stream(key);
    if (!objeto) return null;
    const partes: Buffer[] = [];
    for await (const parte of objeto.body) partes.push(Buffer.isBuffer(parte) ? parte : Buffer.from(parte as Uint8Array));
    return { body: Buffer.concat(partes), info: objeto.info };
  }

  async stream(key: string, range?: ByteRange): Promise<{ body: Readable; info: ObjectInfo } | null> {
    try {
      const resposta = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      );
      // com Range, o tamanho TOTAL vem no Content-Range ("bytes 0-99/1234")
      const total = resposta.ContentRange ? Number(resposta.ContentRange.split('/')[1]) : resposta.ContentLength;
      return {
        body: resposta.Body as Readable,
        info: { sizeBytes: total ?? 0, mimeType: resposta.ContentType ?? 'application/octet-stream' },
      };
    } catch (erro) {
      if (naoExiste(erro)) return null;
      throw erro;
    }
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const resposta = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: resposta.ContentLength ?? 0, mimeType: resposta.ContentType ?? 'application/octet-stream' };
    } catch (erro) {
      if (naoExiste(erro)) return null;
      throw erro;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  localPath(): null {
    return null;
  }
}

export function s3ConfigFromEnv(env: Env): S3Config {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error('STORAGE_DRIVER=s3 exige S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY no ambiente');
  }
  return {
    endpoint: S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
}

export function createStorageProvider(env: Env): StorageProvider {
  if (env.STORAGE_DRIVER === 'memory') return new MemoryStorageProvider(env.JWT_SECRET);
  if (env.STORAGE_DRIVER === 's3') return new S3StorageProvider(env.JWT_SECRET, s3ConfigFromEnv(env));
  return new DiskStorageProvider(env.JWT_SECRET, env.STORAGE_DIR);
}
