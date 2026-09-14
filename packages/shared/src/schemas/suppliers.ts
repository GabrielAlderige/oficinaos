import { z } from 'zod';
import { isValidCnpj } from '../br/document';
import { optionalEmailSchema, optionalPhoneSchema, optionalText } from './common';
import { addressOutSchema, addressSchema } from './organization';

/**
 * Fornecedor da oficina (MVP 2, E10). É a base da cadeia da peça: a cotação por
 * link (E11) manda o pedido de preço para ele, e a compra (E12) vira pedido.
 *
 * O mínimo é o nome — como no cliente. Autopeças de bairro muitas vezes é "o
 * Zé da Distribuidora" com um WhatsApp, e travar o cadastro por CNPJ faria a
 * oficina continuar anotando no caderno.
 */

/** Categorias são rótulos livres, sugeridos a partir das categorias de peça da oficina. */
const categoriesSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20, 'Use no máximo 20 categorias')
  .transform((lista) => [...new Set(lista.map((item) => item.trim()))]);

const supplierFields = {
  name: z.string().trim().min(2, 'Informe o nome').max(160, 'Use no máximo 160 caracteres'),
  legalName: optionalText(160),
  /** fornecedor é empresa: aqui só CNPJ (inclusive o alfanumérico) */
  document: z
    .string()
    .trim()
    .refine((valor) => valor === '' || isValidCnpj(valor), 'CNPJ inválido'),
  contactName: optionalText(120),
  phone: optionalPhoneSchema,
  whatsapp: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: addressSchema,
  categories: categoriesSchema,
  /** dias úteis que ele costuma levar para entregar; é o que pesa no "mais rápido" da E11 */
  leadTimeDays: z.number().int().min(0, 'Não existe prazo negativo').max(365).nullable(),
  /** nota da própria oficina, de 1 a 5 */
  rating: z.number().int().min(1).max(5).nullable(),
  notes: optionalText(2000),
};

/** Criação: só `name` é obrigatório; o resto tem padrão. */
export const supplierFormSchema = z.object({
  ...supplierFields,
  legalName: supplierFields.legalName.default(''),
  document: supplierFields.document.default(''),
  contactName: supplierFields.contactName.default(''),
  phone: supplierFields.phone.default(''),
  whatsapp: supplierFields.whatsapp.default(''),
  email: supplierFields.email.default(''),
  address: supplierFields.address.optional(),
  categories: supplierFields.categories.default([]),
  leadTimeDays: supplierFields.leadTimeDays.default(null),
  rating: supplierFields.rating.default(null),
  notes: supplierFields.notes.default(''),
});

/**
 * O formulário do painel: prazo e nota chegam como TEXTO (campo vazio é "não
 * sei"), e viram número ou null na saída. A API revalida com o schema de cima.
 */
export const supplierTextFormSchema = z
  .object({
    name: supplierFields.name,
    legalName: supplierFields.legalName,
    document: supplierFields.document,
    contactName: supplierFields.contactName,
    phone: supplierFields.phone,
    whatsapp: supplierFields.whatsapp,
    email: supplierFields.email,
    address: supplierFields.address,
    categories: supplierFields.categories,
    leadTimeDays: z
      .string()
      .trim()
      .refine((valor) => valor === '' || (/^\d{1,3}$/.test(valor) && Number(valor) <= 365), 'Informe de 0 a 365 dias'),
    rating: z.enum(['', '1', '2', '3', '4', '5']),
    notes: supplierFields.notes,
  })
  .transform(({ leadTimeDays, rating, ...resto }) => ({
    ...resto,
    leadTimeDays: leadTimeDays === '' ? null : Number(leadTimeDays),
    rating: rating === '' ? null : Number(rating),
  }));

/** Edição: SEM padrões, para nunca apagar um campo que não foi enviado. */
export const updateSupplierSchema = z.object(supplierFields).partial();

export const supplierListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** só quem atende essa categoria (ex.: "Freios") */
  category: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const supplierSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  legalName: z.string().nullable(),
  document: z.string().nullable(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  email: z.string().nullable(),
  address: addressOutSchema,
  categories: z.array(z.string()),
  leadTimeDays: z.number().int().nullable(),
  rating: z.number().int().nullable(),
  notes: z.string().nullable(),
  /** peças que têm este fornecedor como preferido */
  preferredPartCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const supplierListItemSchema = supplierSchema.pick({
  id: true,
  name: true,
  document: true,
  contactName: true,
  whatsapp: true,
  phone: true,
  categories: true,
  leadTimeDays: true,
  rating: true,
  preferredPartCount: true,
});

export type SupplierForm = z.input<typeof supplierFormSchema>;
export type SupplierTextForm = z.input<typeof supplierTextFormSchema>;
export type SupplierInput = z.output<typeof supplierFormSchema>;
export type UpdateSupplierInput = z.output<typeof updateSupplierSchema>;
export type SupplierListQuery = z.output<typeof supplierListQuerySchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type SupplierListItem = z.infer<typeof supplierListItemSchema>;
