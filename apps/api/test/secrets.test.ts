import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cifrar, decifrar, dica } from '../src/core/secrets';

const CHAVE = randomBytes(32).toString('base64');

/**
 * Credencial de terceiro guardada no nosso banco (E22). O que precisa ficar
 * provado: o token não fica legível em lugar nenhum, texto adulterado não
 * decifra em silêncio, e chave errada não abre nada.
 */
describe('segredo guardado', () => {
  it('vai e volta igual, sem aparecer em claro', () => {
    const token = 'EAAG...token-da-oficina...ZDZD';
    const guardado = cifrar(token, CHAVE);
    expect(guardado, 'o que vai para o banco não contém o segredo').not.toContain('token-da-oficina');
    expect(guardado.split('.')).toHaveLength(3);
    expect(decifrar(guardado, CHAVE)).toBe(token);
  });

  it('cada gravação é diferente, mesmo com o mesmo texto', () => {
    expect(cifrar('mesmo-token', CHAVE)).not.toBe(cifrar('mesmo-token', CHAVE));
  });

  it('texto adulterado estoura em vez de decifrar torto', () => {
    const guardado = cifrar('token', CHAVE);
    const [iv, tag] = guardado.split('.');
    const trocado = [iv, tag, Buffer.from('outra coisa').toString('base64url')].join('.');
    expect(() => decifrar(trocado, CHAVE)).toThrow();
  });

  it('com outra chave, não abre', () => {
    const guardado = cifrar('token', CHAVE);
    expect(() => decifrar(guardado, randomBytes(32).toString('base64'))).toThrow();
  });

  it('sem chave configurada, o erro diz o que fazer', () => {
    expect(() => cifrar('token', undefined)).toThrow(/SECRETS_KEY/);
    expect(() => cifrar('token', 'chave-curta')).toThrow(/32 bytes/);
  });

  it('a dica mostra só o fim do token', () => {
    expect(dica('EAAGabcdefgh1234')).toBe('••••1234');
  });
});
