import { z } from 'zod';
import { isValidCnpj, isValidCpf } from '../br/document';
import { CUSTOMER_SOURCES, CUSTOMER_TYPES } from '../enums/vehicles';
import { optionalDocumentSchema, optionalEmailSchema, optionalPhoneSchema, optionalText } from './common';
import { addressOutSchema, addressSchema } from './organization';

/**
 * Cadastro de cliente. O mínimo é o nome: no balcão, muita gente dá só nome e
 * WhatsApp, e travar o cadastro por falta de CPF faria a oficina voltar ao papel.
 * Texto opcional aceita "" (a API grava null), como no formulário da oficina.
 */
const customerFields = {
  type: z.enum(CUSTOMER_TYPES),
  name: z.string().trim().min(2, 'Informe o nome').max(160, 'Use no máximo 160 caracteres'),
  document: optionalDocumentSchema,
  phone: optionalPhoneSchema,
  whatsapp: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: addressSchema,
  notes: optionalText(2000),
  source: z.enum(CUSTOMER_SOURCES).or(z.literal('')),
  marketingOptIn: z.boolean(),
};

/** Pessoa física com CPF, empresa com CNPJ. */
function documentMatchesType(value: { type?: string; document?: string }, ctx: z.RefinementCtx) {
  if (!value.document || !value.type) return;
  if (value.type === 'PF' && !isValidCpf(value.document)) {
    ctx.addIssue({ code: 'custom', path: ['document'], message: 'Para pessoa física, informe um CPF válido' });
  }
  if (value.type === 'PJ' && !isValidCnpj(value.document)) {
    ctx.addIssue({ code: 'custom', path: ['document'], message: 'Para empresa, informe um CNPJ válido' });
  }
}

/** Criação: só `name` é obrigatório; o resto tem padrão. */
export const customerFormSchema = z
  .object({
    ...customerFields,
    type: customerFields.type.default('PF'),
    document: customerFields.document.default(''),
    phone: customerFields.phone.default(''),
    whatsapp: customerFields.whatsapp.default(''),
    email: customerFields.email.default(''),
    address: customerFields.address.optional(),
    notes: customerFields.notes.default(''),
    source: customerFields.source.default(''),
    marketingOptIn: customerFields.marketingOptIn.default(false),
  })
  .superRefine(documentMatchesType);

/** Edição: SEM padrões, para nunca apagar um campo que não foi enviado. */
export const updateCustomerSchema = z.object(customerFields).partial().superRefine(documentMatchesType);

export const customerSchema = z.object({
  id: z.uuid(),
  type: z.enum(CUSTOMER_TYPES),
  name: z.string(),
  document: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  email: z.string().nullable(),
  address: addressOutSchema,
  notes: z.string().nullable(),
  source: z.enum(CUSTOMER_SOURCES).nullable(),
  marketingOptIn: z.boolean(),
  /** true quando quem pede não pode ver contato (mecânico): telefone, documento e e-mail vêm mascarados */
  contactMasked: z.boolean(),
  vehicleCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const customerListItemSchema = z.object({
  id: z.uuid(),
  type: z.enum(CUSTOMER_TYPES),
  name: z.string(),
  document: z.string().nullable(),
  whatsapp: z.string().nullable(),
  phone: z.string().nullable(),
  vehicleCount: z.number().int(),
  /** até 3 placas, para reconhecer o cliente na lista */
  plates: z.array(z.string()),
  createdAt: z.string(),
});

export type CustomerForm = z.input<typeof customerFormSchema>;
export type CustomerInput = z.output<typeof customerFormSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type CustomerListItem = z.infer<typeof customerListItemSchema>;
