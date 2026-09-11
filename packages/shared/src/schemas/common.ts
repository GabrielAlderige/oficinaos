import { z } from 'zod';
import { normalizeBrazilianPhone } from '../br/phone';
import { isValidCnpj, isValidCpf } from '../br/document';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'E-mail longo demais')
  .pipe(z.email('E-mail inválido'));

export const personNameSchema = z
  .string()
  .trim()
  .min(2, 'Informe o nome')
  .max(120, 'Use no máximo 120 caracteres');

/** Telefone obrigatório: sai normalizado em E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeBrazilianPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido. Use DDD + número.' });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * Campos opcionais de formulário: aceitam string vazia (campo em branco).
 * Entrada e saída continuam `string`, o que mantém o React Hook Form tipado;
 * a API converte vazio em `null` e normaliza ao gravar.
 */
export const optionalText = (max: number) => z.string().trim().max(max, `Use no máximo ${max} caracteres`);

export const optionalPhoneSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || normalizeBrazilianPhone(v) !== null, 'Telefone inválido. Use DDD + número.');

export const optionalEmailSchema = z
  .string()
  .trim()
  .max(254)
  .refine((v) => v === '' || z.email().safeParse(v).success, 'E-mail inválido');

export const optionalDocumentSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidCnpj(v) || isValidCpf(v), 'CNPJ ou CPF inválido');

export const idParamSchema = z.object({ id: z.uuid('Identificador inválido') });
