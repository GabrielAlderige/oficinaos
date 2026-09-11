import { describe, expect, it } from 'vitest';
import { formatBrazilianPhone, normalizeBrazilianPhone } from './phone';

describe('normalizeBrazilianPhone', () => {
  it.each([
    ['(11) 98765-4321', '+5511987654321'],
    ['11987654321', '+5511987654321'],
    ['+55 11 98765-4321', '+5511987654321'],
    ['5511987654321', '+5511987654321'],
    ['011 98765-4321', '+5511987654321'],
    ['(21) 3456-7890', '+552134567890'],
    ['0 21 3456-7890', '+552134567890'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeBrazilianPhone(input)).toBe(expected);
  });

  it.each([
    ['', 'vazio'],
    ['1234', 'curto demais'],
    ['(20) 98765-4321', 'DDD inexistente'],
    ['(11) 88765-4321', 'celular sem o 9 na frente'],
    ['(11) 9876-5432', 'fixo começando com 9'],
    ['(11) 1234-5678', 'fixo começando com 1'],
  ])('recusa %s (%s)', (input) => {
    expect(normalizeBrazilianPhone(input)).toBeNull();
  });
});

describe('formatBrazilianPhone', () => {
  it('formata celular e fixo', () => {
    expect(formatBrazilianPhone('+5511987654321')).toBe('(11) 98765-4321');
    expect(formatBrazilianPhone('+552134567890')).toBe('(21) 3456-7890');
  });
});
