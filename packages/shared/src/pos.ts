import { z } from 'zod';

/**
 * Maquininha (E50): a cobrança vai do sistema direto para a maquininha Stone
 * do balcão — o atendente não digita valor nenhum nela, o cliente só passa o
 * cartão (ou lê o Pix), e o pagamento volta sozinho para o caixa da OS ou da
 * venda. É o "Connect Stone" (API Pagar.me): cada oficina usa a chave da
 * PRÓPRIA conta Stone; o dinheiro cai na conta dela, nunca passa por nós.
 */

export const POS_METHODS = ['CREDIT_CARD', 'DEBIT_CARD', 'PIX'] as const;
export type PosMethod = (typeof POS_METHODS)[number];
export const POS_METHOD_LABELS: Record<PosMethod, string> = {
  CREDIT_CARD: 'Crédito',
  DEBIT_CARD: 'Débito',
  PIX: 'Pix',
};

/**
 * PENDING: na tela da maquininha, esperando o cartão. PAID: pago e lançado no
 * caixa. CANCELED: a oficina desistiu antes do pagamento. FAILED: recusado.
 * REFUNDED: pago e depois estornado NA maquininha (o estorno é sempre lá).
 */
export const POS_CHARGE_STATUSES = ['PENDING', 'PAID', 'CANCELED', 'FAILED', 'REFUNDED'] as const;
export type PosChargeStatus = (typeof POS_CHARGE_STATUSES)[number];
export const POS_CHARGE_STATUS_LABELS: Record<PosChargeStatus, string> = {
  PENDING: 'Aguardando na maquininha',
  PAID: 'Pago',
  CANCELED: 'Cancelada',
  FAILED: 'Recusada',
  REFUNDED: 'Estornada',
};

/** Parcelas no crédito, sem juros para o cliente (parcelado lojista). */
export const POS_MAX_INSTALLMENTS = 12;

const serialSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{6,24}$/, 'O número de série fica na etiqueta atrás da maquininha (letras e números)');

export const posDeviceSchema = z.object({
  serial: serialSchema,
  name: z.string().trim().min(1, 'Dê um nome (ex.: Balcão)').max(40),
});
export type PosDevice = z.infer<typeof posDeviceSchema>;

export const posSettingsSchema = z.object({
  /** 'stone' quando a oficina colou a chave; 'simulador' antes disso */
  provider: z.enum(['stone', 'simulador']),
  /** a plataforma tem o cadastro de parceiro Stone (sem ele a chave não serve) */
  partnerReady: z.boolean(),
  /** final da chave, para a oficina reconhecer qual está ligada; a chave inteira nunca sai da API */
  keyHint: z.string().nullable(),
  devices: z.array(posDeviceSchema),
  updatedAt: z.string().nullable(),
});
export type PosSettings = z.infer<typeof posSettingsSchema>;

export const updatePosSettingsSchema = z.object({
  /** a Secret Key da conta Stone/Pagar.me da oficina (sk_...) */
  secretKey: z
    .string()
    .trim()
    .regex(/^sk_[A-Za-z0-9_]{8,}$/, 'A chave começa com sk_ (Pagar.me → Desenvolvimento → Chaves)')
    .optional(),
  /** true apaga a chave e volta ao simulador */
  disconnect: z.boolean().optional(),
  devices: z.array(posDeviceSchema).max(10, 'No máximo 10 maquininhas').optional(),
});
export type UpdatePosSettingsInput = z.infer<typeof updatePosSettingsSchema>;

export const startPosChargeSchema = z
  .object({
    clientRequestId: z.uuid(),
    workOrderId: z.uuid().nullable().default(null),
    counterSaleId: z.uuid().nullable().default(null),
    amountCents: z.number().int().positive('Informe o valor'),
    method: z.enum(POS_METHODS),
    installments: z.number().int().min(1).max(POS_MAX_INSTALLMENTS).default(1),
    deviceSerial: serialSchema,
  })
  .refine((v) => (v.workOrderId === null) !== (v.counterSaleId === null), {
    message: 'A cobrança é de uma OS ou de uma venda de balcão',
    path: ['workOrderId'],
  })
  .refine((v) => v.method === 'CREDIT_CARD' || v.installments === 1, {
    message: 'Parcelar só no crédito',
    path: ['installments'],
  });
export type StartPosChargeInput = z.input<typeof startPosChargeSchema>;

export const posChargeSchema = z.object({
  id: z.uuid(),
  status: z.enum(POS_CHARGE_STATUSES),
  environment: z.enum(['SIMULATOR', 'PRODUCTION']),
  workOrderId: z.uuid().nullable(),
  counterSaleId: z.uuid().nullable(),
  amountCents: z.number().int(),
  method: z.enum(POS_METHODS),
  installments: z.number().int(),
  deviceSerial: z.string(),
  paidAmountCents: z.number().int().nullable(),
  paidAt: z.string().nullable(),
  cardBrand: z.string().nullable(),
  authorizationCode: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
});
export type PosCharge = z.infer<typeof posChargeSchema>;
