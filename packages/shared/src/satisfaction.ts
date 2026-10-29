import { z } from 'zod';
import { optionalText } from './schemas/common';

/**
 * Pesquisa de satisfação (E49): a pergunta clássica do NPS — "de 0 a 10,
 * quanto você recomendaria a oficina?" — mais um comentário, por um link que
 * o cliente abre no celular depois de buscar o carro.
 *
 * A nota fica com a OFICINA: é para ela saber quem saiu insatisfeito e ligar
 * antes de perder o cliente. Depois de responder, TODO mundo vê o convite
 * para avaliar no Google, com qualquer nota — mostrar o Google só para quem
 * deu nota alta é "review gating", proibido pelo Google e desonesto (é a
 * mesma regra do convite da E16).
 */

export const NPS_GROUPS = ['PROMOTER', 'PASSIVE', 'DETRACTOR'] as const;
export type NpsGroup = (typeof NPS_GROUPS)[number];
export const NPS_GROUP_LABELS: Record<NpsGroup, string> = {
  PROMOTER: 'Promotor',
  PASSIVE: 'Neutro',
  DETRACTOR: 'Insatisfeito',
};

/** 9 e 10 recomendam; 7 e 8 não atrapalham; de 0 a 6, saiu insatisfeito. */
export function npsGroup(score: number): NpsGroup {
  return score >= 9 ? 'PROMOTER' : score >= 7 ? 'PASSIVE' : 'DETRACTOR';
}

/**
 * NPS = % de promotores − % de insatisfeitos, de −100 a 100. `null` sem
 * resposta: zero respostas não é NPS zero.
 */
export function npsScore(scores: number[]): number | null {
  if (!scores.length) return null;
  const promotores = scores.filter((s) => npsGroup(s) === 'PROMOTER').length;
  const detratores = scores.filter((s) => npsGroup(s) === 'DETRACTOR').length;
  return Math.round(((promotores - detratores) / scores.length) * 100);
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

export function whatsappSurveyMessage(input: { customerName: string; shopName: string; url: string }): string {
  return [
    `Olá, ${primeiroNome(input.customerName)}! Aqui é da ${input.shopName}.`,
    'Como foi o serviço no seu carro? É uma pergunta só, de 0 a 10, e a sua resposta vai direto para o dono da oficina:',
    input.url,
  ].join('\n\n');
}

export const publicSurveySchema = z.object({
  shopName: z.string(),
  customerFirstName: z.string(),
  vehicle: z.string(),
  workOrderNumber: z.number().int(),
  answered: z.boolean(),
  score: z.number().int().nullable(),
  /** só depois de responder, e para qualquer nota */
  googleReviewUrl: z.string().nullable(),
});
export type PublicSurvey = z.infer<typeof publicSurveySchema>;

export const surveyAnswerSchema = z.object({
  score: z.number().int().min(0, 'Escolha uma nota de 0 a 10').max(10, 'Escolha uma nota de 0 a 10'),
  comment: optionalText(1000).default(''),
});
export type SurveyAnswerInput = z.input<typeof surveyAnswerSchema>;

export const satisfactionSummarySchema = z.object({
  nps: z.number().int().nullable(),
  answered: z.number().int(),
  promoters: z.number().int(),
  passives: z.number().int(),
  detractors: z.number().int(),
  /** convidados que ainda não responderam */
  pending: z.number().int(),
  recent: z.array(
    z.object({
      id: z.uuid(),
      score: z.number().int(),
      comment: z.string().nullable(),
      customerName: z.string(),
      workOrderNumber: z.number().int(),
      submittedAt: z.string(),
    }),
  ),
});
export type SatisfactionSummary = z.infer<typeof satisfactionSummarySchema>;
