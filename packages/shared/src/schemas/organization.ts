import { z } from 'zod';
import {
  optionalDocumentSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  optionalText,
} from './common';

export const BRAZIL_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

/** Fusos do Brasil (IANA), com o rótulo que a oficina reconhece. */
export const BRAZIL_TIMEZONES = {
  'America/Sao_Paulo': 'Brasília (SP, RJ, MG, ES, Sul, GO, DF, BA…)',
  'America/Fortaleza': 'Nordeste (CE, RN, PB, PE, PI, MA, AL, SE)',
  'America/Belem': 'Pará e Amapá',
  'America/Araguaina': 'Tocantins',
  'America/Manaus': 'Amazonas (maior parte), Roraima',
  'America/Cuiaba': 'Mato Grosso',
  'America/Campo_Grande': 'Mato Grosso do Sul',
  'America/Porto_Velho': 'Rondônia',
  'America/Rio_Branco': 'Acre (UTC−5)',
  'America/Noronha': 'Fernando de Noronha',
} as const;

export type BrazilTimezone = keyof typeof BRAZIL_TIMEZONES;
const timezoneKeys = Object.keys(BRAZIL_TIMEZONES) as [BrazilTimezone, ...BrazilTimezone[]];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WEEKDAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
  sun: 'Domingo',
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida');
const interval = z
  .tuple([time, time])
  .refine(([start, end]) => start < end, 'O fim precisa ser depois do início');

/** {"mon": [["08:00","12:00"],["13:00","18:00"]], ...}. Dia ausente = fechado. */
export const businessHoursSchema = z.partialRecord(z.enum(WEEKDAYS), z.array(interval).max(3));

export const addressSchema = z.object({
  zip: z.string().trim().refine((v) => v === '' || /^\d{5}-?\d{3}$/.test(v), 'CEP inválido'),
  street: optionalText(160),
  number: optionalText(20),
  complement: optionalText(80),
  district: optionalText(80),
  city: optionalText(80),
  state: z.string().refine((v) => v === '' || (BRAZIL_STATES as readonly string[]).includes(v), 'UF inválida'),
});

export const organizationFormSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da oficina').max(120),
  legalName: optionalText(160),
  document: optionalDocumentSchema,
  phone: optionalPhoneSchema,
  whatsapp: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: addressSchema,
  timezone: z.enum(timezoneKeys),
  businessHours: businessHoursSchema,
});

/** PATCH aceita qualquer subconjunto do formulário. */
export const updateOrganizationSchema = organizationFormSchema.partial();

export const addressOutSchema = z.object({
  zip: z.string(),
  street: z.string(),
  number: z.string(),
  complement: z.string(),
  district: z.string(),
  city: z.string(),
  state: z.string(),
});

export const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  legalName: z.string().nullable(),
  document: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  email: z.string().nullable(),
  address: addressOutSchema,
  timezone: z.string(),
  businessHours: businessHoursSchema,
  createdAt: z.string(),
});

export type OrganizationForm = z.input<typeof organizationFormSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type BusinessHours = z.infer<typeof businessHoursSchema>;
