import { describe, expect, it } from 'vitest';
import {
  formatMinutesShort,
  formatReportCell,
  reportCellToCsv,
  reportFileName,
  reportToCsv,
  type ReportColumn,
} from './reports';

const colunas: ReportColumn[] = [
  { key: 'nome', label: 'Serviço', format: 'text' },
  { key: 'quantidade', label: 'Quantidade', format: 'number' },
  { key: 'valor', label: 'Faturado', format: 'money' },
];

describe('células do relatório', () => {
  it('na tela, dinheiro sai formatado e vazio vira travessão', () => {
    expect(formatReportCell(123_456, 'money')).toContain('1.234,56');
    expect(formatReportCell(null, 'money')).toBe('–');
    expect(formatReportCell(2_550, 'percent')).toBe('25,5%');
    expect(formatReportCell('2026-09-18', 'date')).toBe('18/09/2026');
  });

  it('tempo sai como a oficina fala', () => {
    expect(formatMinutesShort(45)).toBe('45 min');
    expect(formatMinutesShort(90)).toBe('1h30');
    expect(formatMinutesShort(120)).toBe('2h');
  });

  it('no CSV, dinheiro é NÚMERO com vírgula: a planilha precisa somar a coluna', () => {
    expect(reportCellToCsv(123_456, 'money')).toBe('1234,56');
    expect(reportCellToCsv(2_550, 'percent')).toBe('25,50');
    expect(reportCellToCsv(null, 'money')).toBe('');
  });
});

describe('CSV do relatório', () => {
  it('sai com BOM, ponto e vírgula e CRLF — o Excel em português abre direto', () => {
    const csv = reportToCsv(colunas, [{ nome: 'Troca de óleo', quantidade: 12, valor: 145_000 }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Serviço;Quantidade;Faturado\r\n');
    expect(csv).toContain('Troca de óleo;12;1450,00');
  });

  it('ponto e vírgula, aspas e quebra de linha dentro do texto são escapados', () => {
    const csv = reportToCsv(colunas, [{ nome: 'Disco; "ventilado"\naro 15', quantidade: 1, valor: 0 }]);
    expect(csv).toContain('"Disco; ""ventilado""\naro 15"');
  });

  it('o cabeçalho diz de QUEM e de QUANDO é a planilha', () => {
    const csv = reportToCsv(colunas, [{ nome: 'Troca de óleo', quantidade: 12, valor: 145_000 }], {
      cabecalho: {
        organizacao: 'Oficina do Gabriel',
        titulo: 'Serviços',
        pergunta: 'Quais serviços a oficina mais faz?',
        periodo: '1 a 30 de setembro',
        emitidoEm: '01/10/2026 16:22',
      },
    });
    // sem isto, o que chega no contador é uma grade de números sem dono nem data
    expect(csv).toContain('Oficina do Gabriel');
    expect(csv).toContain('Período;1 a 30 de setembro');
    expect(csv).toContain('Emitido em;01/10/2026 16:22');
    // e a tabela continua logo abaixo, separada por uma linha vazia
    expect(csv).toContain('\r\n\r\nServiço;Quantidade;Faturado\r\n');
  });

  it('o total fecha embaixo, separado da tabela', () => {
    const csv = reportToCsv(colunas, [{ nome: 'Troca de óleo', quantidade: 12, valor: 145_000 }], {
      totals: { quantidade: 12, valor: 145_000 },
    });
    // a primeira coluna não tem total próprio: vira o rótulo
    expect(csv).toContain('\r\n\r\nTOTAL;12;1450,00');
  });

  it('sem cabeçalho e sem total, o arquivo é exatamente o de antes', () => {
    const csv = reportToCsv(colunas, [{ nome: 'Troca de óleo', quantidade: 12, valor: 145_000 }]);
    expect(csv).toBe(
      `${String.fromCharCode(0xfeff)}Serviço;Quantidade;Faturado\r\nTroca de óleo;12;1450,00\r\n`,
    );
  });

  it('o nome do arquivo não tem acento nem espaço', () => {
    expect(reportFileName('Lucro estimado', '2026-09-01', '2026-09-30')).toBe('lucro-estimado-2026-09-01-a-2026-09-30.csv');
    // o PDF reaproveita o mesmo nome, só trocando a extensão
    expect(reportFileName('Lucro estimado', '2026-09-01', '2026-09-30', 'pdf')).toBe(
      'lucro-estimado-2026-09-01-a-2026-09-30.pdf',
    );
    expect(reportFileName('Aprovação de orçamentos', '2026-01-01', '2026-01-31')).toBe(
      'aprovacao-de-orcamentos-2026-01-01-a-2026-01-31.csv',
    );
  });
});
