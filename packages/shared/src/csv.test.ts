import { describe, expect, it } from 'vitest';
import { normalizeHeader, parseCsv, parseCsvLines, parseCsvMoney } from './csv';

describe('leitura de CSV', () => {
  it('lê o ponto e vírgula do Excel em português, com BOM e CRLF', () => {
    const { headers, rows } = parseCsv('﻿Código;Descrição;Preço\r\nDF-220;Disco;189,90\r\n');
    expect(headers).toEqual(['codigo', 'descricao', 'preco']);
    expect(rows).toEqual([{ codigo: 'DF-220', descricao: 'Disco', preco: '189,90' }]);
  });

  it('lê vírgula quando é esse o separador', () => {
    const { rows } = parseCsv('code,name\nAB1,Filtro de óleo\n');
    expect(rows).toEqual([{ code: 'AB1', name: 'Filtro de óleo' }]);
  });

  it('aspas guardam separador, quebra de linha e aspas duplicadas', () => {
    const linhas = parseCsvLines('a;b\n"Disco; ventilado";"aro 15\ncom furo"\n"Marca ""X""";2\n');
    expect(linhas[1]).toEqual(['Disco; ventilado', 'aro 15\ncom furo']);
    expect(linhas[2]).toEqual(['Marca "X"', '2']);
  });

  it('linha em branco no fim não vira registro', () => {
    expect(parseCsv('a;b\n1;2\n\n').rows).toHaveLength(1);
  });

  it('coluna que falta vira vazio, e coluna a mais é ignorada', () => {
    const { rows } = parseCsv('codigo;preco\nX1\n');
    expect(rows[0]).toEqual({ codigo: 'X1', preco: '' });
  });

  it('cabeçalho perde acento, espaço e pontuação', () => {
    expect(normalizeHeader('Preço Unit.')).toBe('precounit');
    expect(normalizeHeader(' CÓDIGO ')).toBe('codigo');
  });
});

describe('valor do CSV', () => {
  it('entende o jeito brasileiro', () => {
    expect(parseCsvMoney('1.234,56')).toBe(123_456);
    expect(parseCsvMoney('R$ 89,90')).toBe(8_990);
    expect(parseCsvMoney('89')).toBe(8_900);
  });

  it('entende o jeito de planilha estrangeira', () => {
    expect(parseCsvMoney('1234.56')).toBe(123_456);
    expect(parseCsvMoney('1,234.56')).toBe(123_456);
  });

  it('ponto com três casas é milhar, não decimal', () => {
    expect(parseCsvMoney('1.234')).toBe(123_400);
  });

  it('recusa o que não é número', () => {
    expect(parseCsvMoney('sob consulta')).toBeNull();
    expect(parseCsvMoney('')).toBeNull();
  });
});
