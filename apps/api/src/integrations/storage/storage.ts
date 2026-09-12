import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
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
  get(key: string): Promise<{ body: Buffer; info: ObjectInfo } | null>;
  head(key: string): Promise<ObjectInfo | null>;
  remove(key: string): Promise<void>;
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
  abstract get(key: string): Promise<{ body: Buffer; info: ObjectInfo } | null>;
  abstract head(key: string): Promise<ObjectInfo | null>;
  abstract remove(key: string): Promise<void>;
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

  async get(key: string): Promise<{ body: Buffer; info: ObjectInfo } | null> {
    const info = await this.head(key);
    if (!info) return null;
    return { body: await readFile(this.pathOf(key)), info };
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

  async get(key: string): Promise<{ body: Buffer; info: ObjectInfo } | null> {
    return this.objects.get(key) ?? null;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    return this.objects.get(key)?.info ?? null;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export function createStorageProvider(env: Env): StorageProvider {
  return env.STORAGE_DRIVER === 'memory'
    ? new MemoryStorageProvider(env.JWT_SECRET)
    : new DiskStorageProvider(env.JWT_SECRET, env.STORAGE_DIR);
}
