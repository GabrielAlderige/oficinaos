import { z } from 'zod';

/**
 * Interessados vindos da landing (E42).
 *
 * Existe para o remarketing: quem entrou no site, deixou telefone e não
 * fechou na hora. A planilha sai daqui.
 *
 * O telefone é obrigatório e o e-mail não: dono de oficina responde no
 * WhatsApp e quase nunca no e-mail. Pedir os dois como obrigatório derruba a
 * conversão do formulário por um campo que não vai ser usado.
 */
export const PROSPECT_SOURCES = ['LANDING', 'WHATSAPP', 'INDICACAO', 'OUTRO'] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

export const PROSPECT_SOURCE_LABELS: Record<ProspectSource, string> = {
  LANDING: 'Site',
  WHATSAPP: 'WhatsApp',
  INDICACAO: 'Indicação',
  OUTRO: 'Outro',
};

/** Só dígitos, 10 ou 11 (fixo com DDD, ou celular com o 9). */
const telefone = z
  .string()
  .trim()
  .min(1, 'Informe o WhatsApp')
  .transform((valor) => valor.replace(/\D/g, ''))
  .refine((digitos) => digitos.length === 10 || digitos.length === 11, 'Telefone com DDD, 10 ou 11 dígitos');

export const createProspectSchema = z.object({
  name: z.string().trim().min(2, 'Diga seu nome').max(120),
  phone: telefone,
  /** opcional de propósito: ver o comentário do módulo */
  email: z
    .string()
    .trim()
    .max(160)
    .toLowerCase()
    .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail inválido')
    .optional()
    .default(''),
  workshopName: z.string().trim().max(120).optional().default(''),
  message: z.string().trim().max(500).optional().default(''),
  source: z.enum(PROSPECT_SOURCES).optional().default('LANDING'),
  /**
   * Campo-armadilha: fica escondido no formulário, então pessoa nenhuma
   * preenche. Robô de spam preenche tudo o que encontra — e é assim que a API
   * separa os dois sem CAPTCHA, que atrapalharia quem é de verdade.
   */
  website: z.string().max(200).optional().default(''),
});
export type CreateProspectInput = z.input<typeof createProspectSchema>;

export const prospectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  workshopName: z.string(),
  message: z.string(),
  source: z.enum(PROSPECT_SOURCES),
  createdAt: z.string(),
  contactedAt: z.string().nullable(),
  notes: z.string(),
});
export type Prospect = z.infer<typeof prospectSchema>;

export const prospectsOverviewSchema = z.object({
  prospects: z.array(prospectSchema),
  total: z.number().int(),
  aguardando: z.number().int(),
  /** entraram nos últimos 7 dias: é o número que diz se a divulgação está andando */
  daSemana: z.number().int(),
});
export type ProspectsOverview = z.infer<typeof prospectsOverviewSchema>;

export const updateProspectSchema = z.object({
  contacted: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type UpdateProspectInput = z.infer<typeof updateProspectSchema>;

/** O que a landing mostra depois de enviar. Curto: a pessoa já vai para o WhatsApp. */
export const prospectCreatedSchema = z.object({ ok: z.literal(true) });

/** WhatsApp do comercial, com a mensagem já escrita. */
export function whatsappDoComercial(numero: string, texto: string): string {
  return `https://wa.me/55${numero.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}
