/**
 * URL assinada do storage (ARCHITECTURE §11): o navegador nunca recebe uma
 * chave crua, e a assinatura tem que barrar tudo o que não foi a API que emitiu.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiskStorageProvider, MemoryStorageProvider } from '../src/integrations/storage/storage';

const SECRET = 'segredo-de-teste-com-bem-mais-de-32-caracteres';
const KEY = 'org-123/os-456/foto.jpg';

/** Desmonta a URL assinada como a rota do objeto vai fazer. */
function parse(url: string) {
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  return {
    key: Buffer.from(params.get('k') ?? '', 'base64url').toString('utf8'),
    action: params.get('a') as 'put' | 'get',
    expires: Number(params.get('e')),
    signature: params.get('s') ?? '',
  };
}

describe('URL assinada', () => {
  const storage = new MemoryStorageProvider(SECRET);

  it('leva a chave e é aceita de volta', () => {
    const signed = storage.signDownload(KEY);
    const parsed = parse(signed.url);
    expect(parsed.key).toBe(KEY);
    expect(signed.url.startsWith('/api/v1/uploads/object?')).toBe(true);
    expect(storage.verify(parsed)).toBe(true);
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('assinatura de leitura não serve para enviar arquivo', () => {
    const parsed = parse(storage.signDownload(KEY).url);
    expect(storage.verify({ ...parsed, action: 'put' })).toBe(false);
  });

  it('trocar a chave invalida a assinatura', () => {
    const parsed = parse(storage.signDownload(KEY).url);
    expect(storage.verify({ ...parsed, key: 'org-123/os-456/outra.jpg' })).toBe(false);
  });

  it('esticar a validade invalida a assinatura', () => {
    const parsed = parse(storage.signDownload(KEY).url);
    expect(storage.verify({ ...parsed, expires: parsed.expires + 3600 })).toBe(false);
  });

  it('URL expirada é recusada', () => {
    const parsed = parse(storage.signUpload(KEY, -10).url);
    expect(storage.verify(parsed)).toBe(false);
  });

  it('assinatura de outra instalação (outro segredo) é recusada', () => {
    const outra = new MemoryStorageProvider('outro-segredo-de-teste-com-mais-de-32-caracteres');
    expect(storage.verify(parse(outra.signDownload(KEY).url))).toBe(false);
  });

  it('assinatura vazia ou lixo é recusada, sem estourar', () => {
    const parsed = parse(storage.signDownload(KEY).url);
    expect(storage.verify({ ...parsed, signature: '' })).toBe(false);
    expect(storage.verify({ ...parsed, signature: 'não-é-assinatura' })).toBe(false);
    expect(storage.verify({ ...parsed, expires: Number.NaN })).toBe(false);
  });
});

describe('driver de disco', () => {
  let dir: string;
  let storage: DiskStorageProvider;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oficinaos-storage-'));
    storage = new DiskStorageProvider(SECRET, dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('grava, informa tamanho e tipo, lê e apaga', async () => {
    const body = Buffer.from('conteúdo da foto');
    await storage.put(KEY, body, 'image/jpeg');

    expect(await storage.head(KEY)).toEqual({ sizeBytes: body.byteLength, mimeType: 'image/jpeg' });
    const read = await storage.get(KEY);
    expect(read?.body.equals(body)).toBe(true);

    await storage.remove(KEY);
    expect(await storage.head(KEY)).toBeNull();
    expect(await storage.get(KEY)).toBeNull();
  });

  it('arquivo que não existe devolve null, não erro', async () => {
    expect(await storage.head('org-123/nao-existe.jpg')).toBeNull();
  });

  it('chave não escapa da pasta base', async () => {
    await expect(storage.put('../fora.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(/inválida/);
    await expect(storage.head('../../etc/passwd')).rejects.toThrow(/inválida/);
  });
});
