import { describe, expect, it } from 'vitest';
import { formatBRL } from './money';

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
