import { z } from 'zod';

/**
 * Códigos de erro estáveis da API. O front decide a mensagem pelo `code`,
 * nunca pelo texto. Novos códigos entram aqui conforme os módulos nascem.
 */
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  // auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  NO_ACTIVE_MEMBERSHIP: 'NO_ACTIVE_MEMBERSHIP',
  // equipe
  LAST_OWNER: 'LAST_OWNER',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  // clientes e veículos
  CUSTOMER_DOCUMENT_TAKEN: 'CUSTOMER_DOCUMENT_TAKEN',
  PLATE_ALREADY_REGISTERED: 'PLATE_ALREADY_REGISTERED',
  ODOMETER_DECREASE: 'ODOMETER_DECREASE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Corpo de erro no formato RFC 9457 (application/problem+json). */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string().optional(),
});

export type Problem = z.infer<typeof problemSchema>;
