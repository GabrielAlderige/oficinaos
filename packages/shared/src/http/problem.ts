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
  // catálogo e estoque
  SERVICE_NAME_TAKEN: 'SERVICE_NAME_TAKEN',
  PART_SKU_TAKEN: 'PART_SKU_TAKEN',
  CATEGORY_NAME_TAKEN: 'CATEGORY_NAME_TAKEN',
  STOCK_NOT_TRACKED: 'STOCK_NOT_TRACKED',
  STOCK_NO_CHANGE: 'STOCK_NO_CHANGE',
  // ordem de serviço
  /** o PATCH veio com uma versão velha: outra pessoa salvou antes */
  WORK_ORDER_VERSION_CONFLICT: 'WORK_ORDER_VERSION_CONFLICT',
  /** a ação não vale a partir do status atual */
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  /** desconto acima do limite do papel: "peça a um gerente" */
  DISCOUNT_ABOVE_LIMIT: 'DISCOUNT_ABOVE_LIMIT',
  /** OS entregue ou cancelada não recebe mais mudança */
  WORK_ORDER_NOT_EDITABLE: 'WORK_ORDER_NOT_EDITABLE',
  /** item já aprovado pelo cliente: precisa de work_orders:edit_approved */
  ITEM_ALREADY_APPROVED: 'ITEM_ALREADY_APPROVED',
  /** o arquivo não terminou de subir para o storage */
  UPLOAD_INCOMPLETE: 'UPLOAD_INCOMPLETE',
  // pagamento
  /** o valor passa do que falta receber: crédito a favor do cliente é MVP 2 */
  PAYMENT_EXCEEDS_BALANCE: 'PAYMENT_EXCEEDS_BALANCE',
  /** o lançamento já estava cancelado */
  PAYMENT_ALREADY_CANCELED: 'PAYMENT_ALREADY_CANCELED',
  // fornecedores
  /** já existe fornecedor com este CNPJ na oficina */
  SUPPLIER_DOCUMENT_TAKEN: 'SUPPLIER_DOCUMENT_TAKEN',
  // cotação com fornecedores
  /** cancelada, já escolhida ou vencida: não aceita mais resposta */
  SUPPLIER_QUOTE_CLOSED: 'SUPPLIER_QUOTE_CLOSED',
  /** a resposta veio para um conteúdo diferente do atual */
  SUPPLIER_QUOTE_OUTDATED: 'SUPPLIER_QUOTE_OUTDATED',
  // agenda
  /** o mecânico já tem compromisso naquela hora; com `force` o encaixe passa */
  APPOINTMENT_CONFLICT: 'APPOINTMENT_CONFLICT',
  /** o check-in já foi feito: o agendamento já tem OS */
  APPOINTMENT_ALREADY_CHECKED_IN: 'APPOINTMENT_ALREADY_CHECKED_IN',
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
