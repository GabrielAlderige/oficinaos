import { describe, expect, it } from 'vitest';
import { npsGroup, npsScore, surveyAnswerSchema, whatsappSurveyMessage } from './satisfaction';

describe('pesquisa de satisfação (E49)', () => {
  it('separa promotor, neutro e insatisfeito como o NPS', () => {
    expect([10, 9, 8, 7, 6, 0].map(npsGroup)).toEqual(['PROMOTER', 'PROMOTER', 'PASSIVE', 'PASSIVE', 'DETRACTOR', 'DETRACTOR']);
  });

  it('NPS = % promotores − % insatisfeitos; sem resposta não é zero', () => {
    expect(npsScore([10, 10, 9, 8, 3])).toBe(40); // 60% − 20%
    expect(npsScore([2, 3])).toBe(-100);
    expect(npsScore([])).toBeNull();
  });

  it('a nota vai de 0 a 10, inteira', () => {
    expect(surveyAnswerSchema.safeParse({ score: 11 }).success).toBe(false);
    expect(surveyAnswerSchema.safeParse({ score: 7.5 }).success).toBe(false);
    expect(surveyAnswerSchema.safeParse({ score: 0 }).success).toBe(true);
  });

  it('a mensagem chama pelo primeiro nome e leva o link', () => {
    const texto = whatsappSurveyMessage({ customerName: 'Ana Paula Ribeiro', shopName: 'Kers', url: 'https://x/pesquisa/abc' });
    expect(texto).toContain('Olá, Ana!');
    expect(texto).toContain('https://x/pesquisa/abc');
  });
});
