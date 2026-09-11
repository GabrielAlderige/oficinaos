import { describe, expect, it } from 'vitest';
import { formatDocument, isValidCnpj, isValidCpf, normalizeDocument } from './document';

describe('CPF', () => {
  it('aceita CPF válido com ou sem pontuação', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('recusa dígito verificador errado, repetido e tamanho errado', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('5299822472')).toBe(false);
  });
});

describe('CNPJ', () => {
  it('aceita o CNPJ numérico tradicional', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
  });

  it('aceita o CNPJ alfanumérico (exemplo oficial da Receita)', () => {
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12abc34501de35')).toBe(true);
  });

  it('recusa dígito errado, repetido e letra no dígito verificador', () => {
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
    expect(isValidCnpj('12.ABC.345/01DE-3A')).toBe(false);
  });
});

describe('normalizeDocument / formatDocument', () => {
  it('normaliza e formata os dois tipos', () => {
    expect(normalizeDocument('529.982.247-25')).toBe('52998224725');
    expect(normalizeDocument('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(normalizeDocument('123')).toBeNull();
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatDocument('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });
});
