import { z } from 'zod';
import { FISCAL_ENVIRONMENTS, INVOICE_KINDS, INVOICE_STATUSES, TAX_REGIMES } from '../enums/fiscal';

// ------------------------------ configuração ------------------------------

/**
 * Dados fiscais da oficina. Ficam em tabela própria, e não em `organizations`,
 * porque são muitos campos que só interessam a quem emite nota — e porque a
 * nota de peça (etapa futura) vai acrescentar mais uma dúzia.
 *
 * Repare no que NÃO está aqui: certificado digital e senha. Eles vão direto
 * para o emissor, que é quem assina; o sistema guarda só o identificador da
 * empresa lá (`providerCompanyId`). Segredo que não passa pelo nosso banco é
 * segredo que não vaza do nosso banco.
 */
export const fiscalSettingsSchema = z.object({
  municipalRegistration: z.string().trim().max(30).nullable(),
  stateRegistration: z.string().trim().max(30).nullable(),
  taxRegime: z.enum(TAX_REGIMES).nullable(),
  cnae: z.string().trim().max(10).nullable(),
  /** item da lista da LC 116; oficina costuma ser 14.01 */
  serviceListItem: z.string().trim().max(10).nullable(),
  municipalServiceCode: z.string().trim().max(20).nullable(),
  /** alíquota do ISS em pontos-base: 2,5% = 250 */
  issRateBps: z.number().int().min(0).max(10_000).nullable(),
  issRetainedDefault: z.boolean(),
  rpsSeries: z.string().trim().min(1).max(5),
  environment: z.enum(FISCAL_ENVIRONMENTS),
  provider: z.string().trim().max(40).nullable(),
  providerCompanyId: z.string().trim().max(120).nullable(),
  /** o que a oficina quer que apareça no fim da discriminação (ex.: garantia) */
  additionalInformation: z.string().trim().max(1000).nullable(),
  updatedAt: z.iso.datetime().nullable(),
});
export type FiscalSettings = z.infer<typeof fiscalSettingsSchema>;

export const updateFiscalSettingsSchema = fiscalSettingsSchema
  .omit({ updatedAt: true, environment: true, provider: true, providerCompanyId: true })
  .partial()
  .extend({
    providerCompanyId: z.string().trim().max(120).nullable().optional(),
  });
export type UpdateFiscalSettingsInput = z.infer<typeof updateFiscalSettingsSchema>;

// --------------------------------- nota ----------------------------------

export const invoiceItemSchema = z.object({
  id: z.uuid(),
  description: z.string(),
  quantity: z.number(),
  unitPriceCents: z.number().int(),
  totalCents: z.number().int(),
  /** null quando o item saiu da OS depois: a nota é cópia congelada (D36) */
  workOrderItemId: z.uuid().nullable(),
});
export type InvoiceItem = z.infer<typeof invoiceItemSchema>;

export const invoiceSchema = z.object({
  id: z.uuid(),
  kind: z.enum(INVOICE_KINDS),
  status: z.enum(INVOICE_STATUSES),
  environment: z.enum(FISCAL_ENVIRONMENTS),
  provider: z.string().nullable(),
  workOrderId: z.uuid(),
  workOrderNumber: z.number().int(),
  customerId: z.uuid(),
  customerName: z.string(),
  vehiclePlate: z.string().nullable(),
  /** número do RPS, que é nosso; o número da nota vem da prefeitura */
  rpsNumber: z.number().int(),
  rpsSeries: z.string(),
  invoiceNumber: z.string().nullable(),
  verificationCode: z.string().nullable(),
  /** link da nota na prefeitura ou no emissor */
  publicUrl: z.url().nullable(),
  pdfUrl: z.url().nullable(),
  xmlUrl: z.url().nullable(),
  serviceAmountCents: z.number().int(),
  deductionsCents: z.number().int(),
  discountCents: z.number().int(),
  baseAmountCents: z.number().int(),
  issRateBps: z.number().int(),
  issAmountCents: z.number().int(),
  issRetained: z.boolean(),
  irrfCents: z.number().int(),
  pisCents: z.number().int(),
  cofinsCents: z.number().int(),
  csllCents: z.number().int(),
  inssCents: z.number().int(),
  totalCents: z.number().int(),
  netCents: z.number().int(),
  description: z.string(),
  issuedAt: z.iso.datetime().nullable(),
  canceledAt: z.iso.datetime().nullable(),
  cancelReason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  items: z.array(invoiceItemSchema),
});
export type Invoice = z.infer<typeof invoiceSchema>;

/** Uma coisa que falta preencher antes de a nota poder sair. */
export const invoicePendingFieldSchema = z.object({
  onde: z.enum(['oficina', 'cliente', 'os']),
  campo: z.string(),
  mensagem: z.string(),
});

/** O que a tela mostra ANTES de emitir: os números e o que falta. */
export const invoicePreviewSchema = z.object({
  workOrderId: z.uuid(),
  workOrderNumber: z.number().int(),
  customerName: z.string(),
  customerDocument: z.string().nullable(),
  environment: z.enum(FISCAL_ENVIRONMENTS),
  serviceAmountCents: z.number().int(),
  /** as peças da OS: entram na conta do cliente, mas NÃO nesta nota */
  partsAmountCents: z.number().int(),
  discountCents: z.number().int(),
  baseAmountCents: z.number().int(),
  issRateBps: z.number().int(),
  issAmountCents: z.number().int(),
  issRetained: z.boolean(),
  totalCents: z.number().int(),
  description: z.string(),
  items: z.array(
    z.object({
      workOrderItemId: z.uuid(),
      description: z.string(),
      quantity: z.number(),
      unitPriceCents: z.number().int(),
      totalCents: z.number().int(),
    }),
  ),
  pending: z.array(invoicePendingFieldSchema),
  /** já existe nota autorizada para esta OS? */
  existingInvoiceId: z.uuid().nullable(),
});
export type InvoicePreview = z.infer<typeof invoicePreviewSchema>;

export const issueInvoiceSchema = z.object({
  /** rede de oficina repete POST: o segundo devolve a mesma nota (D32) */
  clientRequestId: z.uuid(),
  deductionsCents: z.number().int().min(0).optional(),
  issRetained: z.boolean().optional(),
  irrfCents: z.number().int().min(0).optional(),
  pisCents: z.number().int().min(0).optional(),
  cofinsCents: z.number().int().min(0).optional(),
  csllCents: z.number().int().min(0).optional(),
  inssCents: z.number().int().min(0).optional(),
  /** a oficina pode completar o texto que o cliente vê na prefeitura */
  additionalInformation: z.string().trim().max(1000).optional(),
});
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(5, 'Escreva o motivo do cancelamento').max(255),
});
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;

export const invoiceListQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
