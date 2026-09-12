import { describe, expect, it } from 'vitest';
import { formatBRL, formatBRLInput, formatPercentInput, parseBRL, parsePercent } from './money';

// O Intl separa "R$" do número com espaço não separável (U+00A0).
const NBSP = String.fromCharCode(0xa0);
const brl = (s: string) => s.replace(' ', NBSP);

describe('formatBRL', () => {
  it('formata centavos em reais', () => {
    expect(formatBRL(124000)).toBe(brl('R$ 1.240,00'));
    expect(formatBRL(18990)).toBe(brl('R$ 189,90'));
    expect(formatBRL(5)).toBe(brl('R$ 0,05'));
    expect(formatBRL(0)).toBe(brl('R$ 0,00'));
  });

  it('recusa valor que não é centavo inteiro', () => {
    expect(() => formatBRL(189.9)).toThrow(TypeError);
  });
});

describe('parseBRL (o que a pessoa digita)', () => {
  it('entende o formato brasileiro', () => {
    expect(parseBRL('1.234,56')).toBe(123456);
    expect(parseBRL('1234,5')).toBe(123450);
    expect(parseBRL('1234')).toBe(123400);
    expect(parseBRL('R$ 12,90')).toBe(1290);
    expect(parseBRL('0,99')).toBe(99);
    expect(parseBRL('1.000.000,00')).toBe(100000000);
  });

  it('recusa o ambíguo e o inválido', () => {
    expect(parseBRL('12.5')).toBeNull(); // R$ 12,50 ou R$ 125?
    expect(parseBRL('12,345')).toBeNull();
    expect(parseBRL('abc')).toBeNull();
    expect(parseBRL('')).toBeNull();
    expect(parseBRL('-10')).toBeNull();
  });

  it('ida e volta com o campo', () => {
    expect(formatBRLInput(123456)).toBe('1.234,56');
    expect(parseBRL(formatBRLInput(99))).toBe(99);
  });
});

describe('percentual', () => {
  it('lê e escreve em basis points', () => {
    expect(parsePercent('30')).toBe(3000);
    expect(parsePercent('12,5')).toBe(1250);
    expect(parsePercent('12,5%')).toBe(1250);
    expect(parsePercent('1,234')).toBeNull();
    expect(formatPercentInput(1250)).toBe('12,5');
  });
});
