import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Segredo de terceiro guardado no nosso banco (E22).
 *
 * A regra do projeto é não guardar segredo dos outros — é o que fazemos com o
 * certificado fiscal (D38), que vai direto para o emissor. Com o WhatsApp não
 * há essa saída: quem manda a mensagem é o servidor, e ele precisa do token da
 * oficina. Então guardamos **cifrado**, com uma chave que mora só no ambiente:
 * vazar o banco (backup perdido, dump copiado) não entrega o WhatsApp de
 * ninguém junto.
 *
 * AES-256-GCM: cifra e autentica na mesma operação, então texto adulterado não
 * decifra em silêncio — ele estoura.
 */

const ALGORITMO = 'aes-256-gcm';

function chave(bruta: string | undefined): Buffer {
  if (!bruta) {
    throw new Error('Falta SECRETS_KEY no ambiente: sem ela não dá para guardar credencial de terceiro');
  }
  const buffer = Buffer.from(bruta, 'base64');
  if (buffer.length !== 32) {
    throw new Error('SECRETS_KEY precisa ter 32 bytes em base64 (gere com: openssl rand -base64 32)');
  }
  return buffer;
}

/** `iv.tag.dados`, tudo em base64url — cabe numa coluna de texto. */
export function cifrar(texto: string, chaveBase64: string | undefined): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv(ALGORITMO, chave(chaveBase64), iv);
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  return [iv.toString('base64url'), cifra.getAuthTag().toString('base64url'), dados.toString('base64url')].join('.');
}

export function decifrar(guardado: string, chaveBase64: string | undefined): string {
  const [iv, tag, dados] = guardado.split('.');
  if (!iv || !tag || !dados) throw new Error('Credencial guardada em formato inválido');
  const decifra = createDecipheriv(ALGORITMO, chave(chaveBase64), Buffer.from(iv, 'base64url'));
  decifra.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decifra.update(Buffer.from(dados, 'base64url')), decifra.final()]).toString('utf8');
}

/**
 * O que a tela pode ver: os quatro últimos caracteres. Serve para a pessoa
 * conferir que colou o token certo, e não serve para mais nada.
 */
export const dica = (texto: string): string => `••••${texto.slice(-4)}`;
