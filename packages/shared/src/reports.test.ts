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

  it('o nome do arquivo não tem acento nem espaço', () => {
    expect(reportFileName('Lucro estimado', '2026-09-01', '2026-09-30')).toBe('lucro-estimado-2026-09-01-a-2026-09-30.csv');
    expect(reportFileName('Aprovação de orçamentos', '2026-01-01', '2026-01-31')).toBe(
      'aprovacao-de-orcamentos-2026-01-01-a-2026-01-31.csv',
    );
  });
});
