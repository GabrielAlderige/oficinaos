import { describe, expect, it } from 'vitest';
import { brCode, crc16, mascararChavePix, textoDoBrCode, txidDoBrCode } from './pix';

/**
 * Pix na hora (E32).
 *
 * Um QR de Pix errado não "fica feio": ele não paga, e a oficina descobre com
 * o cliente na frente. Por isso o teste principal é contra o **exemplo oficial
 * do manual do Banco Central** — se o nosso montador divergir dele em um
 * caractere, o CRC muda e o teste cai.
 */
describe('BR Code do Pix', () => {
  /**
   * Exemplo do "Manual de Padrões para Iniciação do Pix" (BCB): chave
   * aleatória, sem valor, GUI em minúsculas. Se o nosso montador divergir dele
   * em um caractere, o CRC muda e este teste cai.
   */
  const OFICIAL =
    '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000' +
    '520400005303986' +
    '5802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';

  it('reproduz o exemplo do Banco Central, byte a byte', () => {
    const gerado = brCode({
      key: '123e4567-e12b-12d1-a456-426655440000',
      merchantName: 'Fulano de Tal',
      merchantCity: 'BRASILIA',
    });
    expect(gerado).toBe(OFICIAL);
  });

  it('o CRC entra com o próprio "6304" dentro, que é onde quase todo gerador erra', () => {
    expect(crc16(OFICIAL.slice(0, -4)), 'o texto conferido termina em 6304').toBe('1D3D');
    expect(OFICIAL.slice(-8, -4), 'e o que vem antes do CRC é o id 63 com tamanho 04').toBe('6304');

    const a = brCode({ key: 'chave@oficina.com', merchantName: 'Oficina', merchantCity: 'Sao Paulo', amountCents: 68_000 });
    const b = brCode({ key: 'chave@oficina.com', merchantName: 'Oficina', merchantCity: 'Sao Paulo', amountCents: 68_001 });
    expect(a.slice(-4), 'um centavo a mais muda o CRC').not.toBe(b.slice(-4));
  });

  it('o valor entra em reais com duas casas, e some quando é zero', () => {
    const comValor = brCode({ key: 'x@y.com', merchantName: 'Oficina', merchantCity: 'Sao Paulo', amountCents: 68_000 });
    expect(comValor, 'R$ 680,00 vira 680.00').toContain('5406680.00');

    const semValor = brCode({ key: 'x@y.com', merchantName: 'Oficina', merchantCity: 'Sao Paulo', amountCents: 0 });
    expect(semValor, 'sem valor o cliente digita').not.toContain('5406');
    expect(semValor, 'e o resto continua de pé').toContain('5802BR');
  });

  it('acento e símbolo saem do nome e da cidade', () => {
    const codigo = brCode({
      key: 'x@y.com',
      merchantName: 'Oficina do Gabriel & Cia. Ltda',
      merchantCity: 'São João da Boa Vista',
      amountCents: 1000,
    });
    expect(codigo).toContain('5925Oficina do Gabriel Cia'); // 25 caracteres, sem "&" nem "."
    expect(codigo).toContain('6015Sao Joao da Boa'); // 15 caracteres, sem til
  });

  it('o identificador aceita só letra e número, e vira *** quando falta', () => {
    expect(txidDoBrCode('OS 12')).toBe('OS12');
    expect(txidDoBrCode('')).toBe('***');
    expect(txidDoBrCode('#$%')).toBe('***');
    expect(txidDoBrCode('A'.repeat(40)), 'o padrão corta em 25').toHaveLength(25);
  });

  it('o texto do BR Code respeita o tamanho do campo', () => {
    expect(textoDoBrCode('Auto Center Três Corações', 25)).toBe('Auto Center Tres Coracoes');
    expect(textoDoBrCode('   muitos    espaços   ', 25)).toBe('muitos espacos');
  });

  it('chave vazia é erro, não um QR que não paga', () => {
    expect(() => brCode({ key: '  ', merchantName: 'Oficina', merchantCity: 'Sao Paulo' })).toThrow();
  });

  it('a chave aparece mascarada na tela', () => {
    expect(mascararChavePix('12345678901')).toBe('123***01');
    expect(mascararChavePix('contato@oficina.com.br')).toBe('co***@oficina.com.br');
    expect(mascararChavePix('11999'), 'chave curta demais não tem o que esconder').toBe('11999');
  });
});
