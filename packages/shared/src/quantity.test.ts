import { describe, expect, it } from 'vitest';
import { formatQuantity, milliToDecimal, milliToNumber, parseQuantity } from './quantity';

describe('quantidades em milésimos', () => {
  it('lê vírgula e ponto como decimal', () => {
    expect(parseQuantity('4,5')).toBe(4500);
    expect(parseQuantity('4.5')).toBe(4500);
    expect(parseQuantity(4.5)).toBe(4500);
    expect(parseQuantity('0,125')).toBe(125);
    expect(parseQuantity('12')).toBe(12000);
    expect(parseQuantity('-2')).toBe(-2000);
    expect(parseQuantity('4.500')).toBe(4500); // o numeric do banco volta assim
  });

  it('recusa mais de 3 casas, float torto e texto', () => {
    expect(parseQuantity('1,2345')).toBeNull();
    expect(parseQuantity(0.1 + 0.2)).toBeNull(); // 0.30000000000000004
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('1.000.000')).toBeNull();
  });

  it('converte de volta sem perder nada', () => {
    expect(milliToNumber(4500)).toBe(4.5);
    expect(milliToDecimal(4500)).toBe('4.500');
    expect(milliToDecimal(-125)).toBe('-0.125');
    expect(milliToDecimal(0)).toBe('0.000');
    expect(parseQuantity(milliToDecimal(123456))).toBe(123456);
  });

  it('exibe no padrão brasileiro', () => {
    expect(formatQuantity(4500, 'L')).toBe('4,5 L');
    expect(formatQuantity(1000)).toBe('1');
    expect(formatQuantity(1250500)).toBe('1.250,5');
  });
});
