import { describe, expect, it } from 'vitest';
import { canonicalPlate, canonicalPlatePrefix, formatPlate, isMercosulPlate, isValidPlate, normalizePlate } from './plate';

describe('placas', () => {
  it('normaliza o que a pessoa digita', () => {
    expect(normalizePlate(' abc-1234 ')).toBe('ABC1234');
    expect(normalizePlate('abc 1d23')).toBe('ABC1D23');
  });

  it('aceita os dois formatos e recusa o resto', () => {
    expect(isValidPlate('ABC-1234')).toBe(true);
    expect(isValidPlate('abc1d23')).toBe(true);
    for (const bad of ['AB12345', 'ABCD123', 'ABC12D3', 'ABC123', '1234567', '']) {
      expect(isValidPlate(bad), bad).toBe(false);
    }
    expect(isMercosulPlate('ABC1D23')).toBe(true);
    expect(isMercosulPlate('ABC1234')).toBe(false);
  });

  it('canônica: a antiga vira Mercosul pela tabela 0→A … 9→J', () => {
    expect(canonicalPlate('ABC-1234')).toBe('ABC1C34');
    expect(canonicalPlate('XYZ9012')).toBe('XYZ9A12');
    expect(canonicalPlate('KLM5967')).toBe('KLM5J67');
    expect(canonicalPlate('ABC1C34')).toBe('ABC1C34');
    expect(canonicalPlate('JOAO')).toBeNull();
  });

  it('a antiga e a convertida são o MESMO carro', () => {
    expect(canonicalPlate('ABC1234')).toBe(canonicalPlate('abc1c34'));
  });

  it('prefixo canônico enquanto digita', () => {
    expect(canonicalPlatePrefix('ab')).toBe('AB');
    expect(canonicalPlatePrefix('ABC1')).toBe('ABC1');
    expect(canonicalPlatePrefix('abc-12')).toBe('ABC1C');
    expect(canonicalPlatePrefix('ABC1C')).toBe('ABC1C');
    expect(canonicalPlatePrefix('ABC1234')).toBe('ABC1C34');
    expect(canonicalPlatePrefix('JOAO')).toBeNull();
    expect(canonicalPlatePrefix('a')).toBeNull();
    expect(canonicalPlatePrefix('ABC12345')).toBeNull();
  });

  it('exibe a antiga com hífen e a Mercosul sem', () => {
    expect(formatPlate('abc1234')).toBe('ABC-1234');
    expect(formatPlate('abc1d23')).toBe('ABC1D23');
  });
});
