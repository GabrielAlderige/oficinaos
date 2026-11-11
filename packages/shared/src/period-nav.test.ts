import { describe, expect, it } from 'vitest';
import { fimDoMes, modoDoPeriodo, periodoDoModo, rotuloDoPeriodo } from './period-nav';

// terça-feira, 10/11/2026
const HOJE = '2026-11-10';

describe('seletor de período', () => {
  it('o período corrente vai como NOME; os outros, como datas', () => {
    expect(periodoDoModo('dia', HOJE, HOJE)).toEqual({ period: 'today', from: null, to: null });
    expect(periodoDoModo('dia', '2026-11-09', HOJE)).toEqual({ period: 'custom', from: '2026-11-09', to: '2026-11-09' });
    // qualquer dia desta semana é "esta semana"
    expect(periodoDoModo('semana', '2026-11-15', HOJE)).toEqual({ period: 'week', from: null, to: null });
    expect(periodoDoModo('semana', '2026-11-08', HOJE)).toEqual({ period: 'custom', from: '2026-11-02', to: '2026-11-08' });
    expect(periodoDoModo('mes', '2026-11-30', HOJE)).toEqual({ period: 'month', from: null, to: null });
    expect(periodoDoModo('mes', '2026-02-14', HOJE)).toEqual({ period: 'custom', from: '2026-02-01', to: '2026-02-28' });
  });

  it('a semana começa na segunda e atravessa mês e ano', () => {
    expect(periodoDoModo('semana', '2026-01-01', HOJE)).toEqual({ period: 'custom', from: '2025-12-29', to: '2026-01-04' });
  });

  it('o fim do mês respeita bissexto e meses de 30', () => {
    expect(fimDoMes('2028-02-10')).toBe('2028-02-29');
    expect(fimDoMes('2026-02-01')).toBe('2026-02-28');
    expect(fimDoMes('2026-09-30')).toBe('2026-09-30');
    expect(fimDoMes('2026-12-05')).toBe('2026-12-31');
  });

  it('deduz o modo pelas datas (o link aberto de fora volta no modo certo)', () => {
    expect(modoDoPeriodo({ period: 'today' }, HOJE)).toBe('dia');
    expect(modoDoPeriodo({ period: 'last30' }, HOJE)).toBe('periodo');
    expect(modoDoPeriodo({ period: 'custom', from: '2026-10-05', to: '2026-10-05' }, HOJE)).toBe('dia');
    expect(modoDoPeriodo({ period: 'custom', from: '2026-11-02', to: '2026-11-08' }, HOJE)).toBe('semana');
    // 7 dias que NÃO começam na segunda são um intervalo, não uma semana
    expect(modoDoPeriodo({ period: 'custom', from: '2026-11-03', to: '2026-11-09' }, HOJE)).toBe('periodo');
    expect(modoDoPeriodo({ period: 'custom', from: '2026-09-01', to: '2026-09-30' }, HOJE)).toBe('mes');
    expect(modoDoPeriodo({ period: 'custom', from: '2026-09-01', to: '2026-09-29' }, HOJE)).toBe('periodo');
  });

  it('escreve o período como a pessoa fala', () => {
    expect(rotuloDoPeriodo('dia', HOJE, HOJE, HOJE)).toBe('Hoje, terça 10/11');
    expect(rotuloDoPeriodo('dia', '2026-11-09', '2026-11-09', HOJE)).toBe('Ontem, segunda 09/11');
    expect(rotuloDoPeriodo('dia', '2025-12-24', '2025-12-24', HOJE)).toBe('Quarta 24/12/2025');
    expect(rotuloDoPeriodo('semana', '2026-11-09', '2026-11-15', HOJE)).toBe('Esta semana · 09/11 a 15/11');
    expect(rotuloDoPeriodo('semana', '2026-11-02', '2026-11-08', HOJE)).toBe('Semana passada · 02/11 a 08/11');
    expect(rotuloDoPeriodo('mes', '2026-10-01', '2026-10-31', HOJE)).toBe('Outubro de 2026');
    expect(rotuloDoPeriodo('periodo', '2026-10-15', '2026-11-10', HOJE)).toBe('15/10/2026 a 10/11/2026');
  });
});
