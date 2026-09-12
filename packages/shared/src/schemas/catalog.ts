import { z } from 'zod';
import { MOVEMENT_TYPES, PART_UNITS, PRICING_MODES } from '../enums/catalog';
import { STOCK_STATUSES } from '../inventory';
import { parseBRL, parsePercent } from '../money';
import { parseQuantity } from '../quantity';
import { optionalText } from './common';

// ---- peças de formulário: texto → número (a saída tem o formato da API) ----

const moneyText = z
  .string()
  .trim()
  .refine((v) => v === '' || parseBRL(v) !== null, 'Valor inválido. Ex.: 1.234,56')
  .transform((v) => (v === '' ? null : parseBRL(v)));

const percentText = z
  .string()
  .trim()
  .refine((v) => v === '' || parsePercent(v) !== null, 'Percentual inválido. Ex.: 30 ou 12,5')
  .transform((v) => (v === '' ? null : parsePercent(v)));

const quantityText = z
  .string()
  .trim()
  .refine((v) => v === '' || (parseQuantity(v) !== null && parseQuantity(v)! >= 0), 'Quantidade inválida. Ex.: 4,5')
  .transform((v) => (v === '' ? 0 : parseQuantity(v)! / 1000));

const intText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d{1,3}(\.?\d{3})*$/.test(v) && Number(v.replace(/\./g, '')) <= max), message)
    .transform((v) => (v === '' ? null : Number(v.replace(/\./g, ''))));

/** "1,5" (horas) → 90 (minutos). */
const hoursText = z
  .string()
  .trim()
  .refine((v) => v === '' || (parseQuantity(v) !== null && parseQuantity(v)! > 0 && parseQuantity(v)! <= 200_000), 'Tempo inválido. Ex.: 1,5 = 1h30')
  .transform((v) => (v === '' ? null : Math.round((parseQuantity(v)! * 60) / 1000)));

/** Quantidade da API: número com até 3 casas. */
export const quantitySchema = z
  .number()
  .min(0, 'Quantidade inválida')
  .max(999_999, 'Quantidade grande demais')
  .refine((v) => parseQuantity(v) !== null, 'Use no máximo 3 casas decimais');

const cents = z.number().int().min(0).max(100_000_000);

// ================================ serviços ================================

const serviceFields = {
  name: z.string().trim().min(2, 'Informe o nome do serviço').max(120),
  category: optionalText(60),
  description: optionalText(1000),
  pricingMode: z.enum(PRICING_MODES),
  /** preço fixo; no modo por hora fica null */
  priceCents: cents.nullable(),
  /** tempo padrão (tempário); obrigatório no modo por hora */
  estimatedMinutes: z.number().int().min(1).max(12_000).nullable(),
  /** a cada X km / Y meses: base de "próxima troca de óleo" (E5) */
  intervalKm: z.number().int().min(100).max(300_000).nullable(),
  intervalMonths: z.number().int().min(1).max(120).nullable(),
  isActive: z.boolean(),
};

function servicePricingIsComplete(
  value: { pricingMode?: string; priceCents?: number | null; estimatedMinutes?: number | null },
  ctx: z.RefinementCtx,
) {
  if (value.pricingMode === 'FIXED' && value.priceCents == null) {
    ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'Informe o preço' });
  }
  if (value.pricingMode === 'HOURLY' && !value.estimatedMinutes) {
    ctx.addIssue({ code: 'custom', path: ['estimatedMinutes'], message: 'Informe o tempo padrão' });
  }
}

export const createServiceSchema = z
  .object({
    ...serviceFields,
    category: serviceFields.category.default(''),
    description: serviceFields.description.default(''),
    pricingMode: serviceFields.pricingMode.default('FIXED'),
    priceCents: serviceFields.priceCents.default(null),
    estimatedMinutes: serviceFields.estimatedMinutes.default(null),
    intervalKm: serviceFields.intervalKm.default(null),
    intervalMonths: serviceFields.intervalMonths.default(null),
    isActive: serviceFields.isActive.default(true),
  })
  .superRefine(servicePricingIsComplete);

/** Edição sem padrões; a coerência preço × modo é conferida na API com o que já está gravado. */
export const updateServiceSchema = z.object(serviceFields).partial();

export const serviceFormSchema = z
  .object({
    name: serviceFields.name,
    category: serviceFields.category,
    description: serviceFields.description,
    pricingMode: serviceFields.pricingMode,
    price: moneyText,
    estimatedHours: hoursText,
    intervalKm: intText(300_000, 'Intervalo inválido'),
    intervalMonths: intText(120, 'Intervalo inválido'),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.pricingMode === 'FIXED' && v.price === null) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'Informe o preço' });
    }
    if (v.pricingMode === 'HOURLY' && v.estimatedHours === null) {
      ctx.addIssue({ code: 'custom', path: ['estimatedHours'], message: 'Informe o tempo padrão' });
    }
  })
  .transform((v) => ({
    name: v.name,
    category: v.category,
    description: v.description,
    pricingMode: v.pricingMode,
    priceCents: v.pricingMode === 'FIXED' ? v.price : null,
    estimatedMinutes: v.estimatedHours,
    intervalKm: v.intervalKm,
    intervalMonths: v.intervalMonths,
    isActive: v.isActive,
  }));

export const serviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  pricingMode: z.enum(PRICING_MODES),
  priceCents: z.number().int().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  /** o que entra no orçamento: fixo, ou hora técnica × tempo; null se a hora técnica não foi configurada */
  effectivePriceCents: z.number().int().nullable(),
  intervalKm: z.number().int().nullable(),
  intervalMonths: z.number().int().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const serviceListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ============================ categorias de peça ============================

export const partCategoryInputSchema = z.object({ name: z.string().trim().min(2, 'Informe o nome').max(60) });
export const partCategorySchema = z.object({ id: z.uuid(), name: z.string(), partCount: z.number().int() });

// ================================== peças ==================================

const partFields = {
  name: z.string().trim().min(2, 'Informe o nome da peça').max(160),
  /** código interno da oficina (etiqueta da prateleira) */
  sku: optionalText(40),
  /** código do fabricante: é por ele que se pede no balcão do fornecedor */
  manufacturerCode: optionalText(60),
  manufacturer: optionalText(60),
  categoryId: z.uuid().nullable(),
  description: optionalText(1000),
  unit: z.enum(PART_UNITS),
  ean: z.string().trim().refine((v) => v === '' || /^(\d{8}|\d{12,14})$/.test(v), 'O EAN/GTIN tem 8, 12, 13 ou 14 dígitos'),
  salePriceCents: cents.nullable(),
  /** margem própria; null = margem padrão da oficina */
  markupBps: z.number().int().min(0).max(100_000).nullable(),
  minQuantity: quantitySchema,
  location: optionalText(60),
  trackStock: z.boolean(),
  isActive: z.boolean(),
};

export const createPartSchema = z.object({
  ...partFields,
  sku: partFields.sku.default(''),
  manufacturerCode: partFields.manufacturerCode.default(''),
  manufacturer: partFields.manufacturer.default(''),
  categoryId: partFields.categoryId.default(null),
  description: partFields.description.default(''),
  unit: partFields.unit.default('UN'),
  ean: partFields.ean.default(''),
  salePriceCents: partFields.salePriceCents.default(null),
  markupBps: partFields.markupBps.default(null),
  minQuantity: partFields.minQuantity.default(0),
  location: partFields.location.default(''),
  trackStock: partFields.trackStock.default(true),
  isActive: partFields.isActive.default(true),
  /** estoque que já existe na prateleira no dia do cadastro (vira movimento "estoque inicial") */
  initialQuantity: quantitySchema.default(0),
  initialUnitCostCents: cents.nullable().default(null),
});

/** Custo não se edita aqui: vem das entradas (fica no livro de movimentos). */
export const updatePartSchema = z.object(partFields).partial();

export const partFormSchema = z
  .object({
    name: partFields.name,
    sku: partFields.sku,
    manufacturerCode: partFields.manufacturerCode,
    manufacturer: partFields.manufacturer,
    categoryId: z.string(),
    description: partFields.description,
    unit: partFields.unit,
    ean: partFields.ean,
    salePrice: moneyText,
    markup: percentText,
    minQuantity: quantityText,
    location: partFields.location,
    trackStock: z.boolean(),
    isActive: z.boolean(),
    initialQuantity: quantityText,
    initialUnitCost: moneyText,
  })
  .transform(({ salePrice, markup, initialUnitCost, categoryId, ...rest }) => ({
    ...rest,
    categoryId: categoryId === '' ? null : categoryId,
    salePriceCents: salePrice,
    markupBps: markup,
    initialUnitCostCents: initialUnitCost,
  }));

export const partSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  manufacturerCode: z.string().nullable(),
  manufacturer: z.string().nullable(),
  category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  description: z.string().nullable(),
  unit: z.enum(PART_UNITS),
  ean: z.string().nullable(),
  salePriceCents: z.number().int().nullable(),
  markupBps: z.number().int().nullable(),
  /** custo × (1 + margem da peça ou da oficina); null sem custo ou para quem não vê custo */
  suggestedPriceCents: z.number().int().nullable(),
  /** true para quem não tem parts:view_cost (mecânico, atendente): custos e margem vêm null */
  costHidden: z.boolean(),
  lastCostCents: z.number().int().nullable(),
  averageCostCents: z.number().int().nullable(),
  quantityOnHand: z.number(),
  quantityReserved: z.number(),
  quantityAvailable: z.number(),
  minQuantity: z.number(),
  stockStatus: z.enum(STOCK_STATUSES),
  location: z.string().nullable(),
  trackStock: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const partListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  manufacturerCode: z.string().nullable(),
  manufacturer: z.string().nullable(),
  categoryName: z.string().nullable(),
  unit: z.enum(PART_UNITS),
  salePriceCents: z.number().int().nullable(),
  quantityOnHand: z.number(),
  quantityAvailable: z.number(),
  minQuantity: z.number(),
  stockStatus: z.enum(STOCK_STATUSES),
  location: z.string().nullable(),
});

export const partListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  /** attention = abaixo do mínimo, sem estoque ou negativo */
  stock: z.enum(['all', 'attention']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ======================= aplicação (em que carro serve) =======================

const applicationYear = z.number().int().min(1950).max(2100).nullable();

export const partApplicationInputSchema = z
  .object({
    make: z.string().trim().min(1, 'Informe a marca').max(60),
    model: optionalText(80).default(''),
    engine: optionalText(40).default(''),
    yearFrom: applicationYear.default(null),
    yearTo: applicationYear.default(null),
    notes: optionalText(200).default(''),
  })
  .refine((v) => !v.yearFrom || !v.yearTo || v.yearTo >= v.yearFrom, {
    path: ['yearTo'],
    message: 'O ano final vem depois do inicial',
  });

export const partApplicationSchema = z.object({
  id: z.uuid(),
  make: z.string(),
  model: z.string().nullable(),
  engine: z.string().nullable(),
  yearFrom: z.number().int().nullable(),
  yearTo: z.number().int().nullable(),
  notes: z.string().nullable(),
});

// ================================== estoque ==================================

const positiveQuantity = quantitySchema.refine((v) => v > 0, 'A quantidade precisa ser maior que zero');

/**
 * Movimentos manuais. ENTRADA soma (e atualiza o custo médio); AJUSTE informa
 * a contagem da prateleira e exige motivo. Saída em OS vem na finalização (E7).
 */
export const stockMovementInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ENTRY'),
    partId: z.uuid(),
    quantity: positiveQuantity,
    unitCostCents: cents.nullable().default(null),
    reason: optionalText(200).default(''),
  }),
  z.object({
    type: z.literal('ADJUSTMENT'),
    partId: z.uuid(),
    /** quanto tem de fato na prateleira agora */
    countedQuantity: quantitySchema,
    reason: z.string().trim().min(3, 'Explique o motivo do ajuste').max(200),
  }),
]);

export const movementSchema = z.object({
  id: z.uuid(),
  type: z.enum(MOVEMENT_TYPES),
  /** com sinal: + entrou, − saiu */
  quantity: z.number(),
  unitCostCents: z.number().int().nullable(),
  balanceAfter: z.number(),
  reason: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});

export const movementResultSchema = z.object({ part: partSchema, movement: movementSchema });

export const inventorySummarySchema = z.object({
  trackedParts: z.number().int(),
  low: z.number().int(),
  out: z.number().int(),
  negative: z.number().int(),
  /** valor ao custo médio; null para quem não vê custo */
  stockValueCents: z.number().int().nullable(),
});

// ============================ formulários do painel ============================

const requiredQuantityText = (message: string, allowZero: boolean) =>
  z
    .string()
    .trim()
    .refine((v) => {
      const milli = parseQuantity(v);
      return milli !== null && (allowZero ? milli >= 0 : milli > 0) && milli <= 999_999_000;
    }, message)
    .transform((v) => parseQuantity(v)! / 1000);

export const stockEntryFormSchema = z
  .object({
    quantity: requiredQuantityText('Informe a quantidade que entrou. Ex.: 10 ou 4,5', false),
    unitCost: moneyText,
    reason: optionalText(200),
  })
  .transform((v) => ({ type: 'ENTRY' as const, quantity: v.quantity, unitCostCents: v.unitCost, reason: v.reason }));

export const stockAdjustmentFormSchema = z
  .object({
    countedQuantity: requiredQuantityText('Informe quanto tem na prateleira. Ex.: 12', true),
    reason: z.string().trim().min(3, 'Explique o motivo do ajuste').max(200),
  })
  .transform((v) => ({ type: 'ADJUSTMENT' as const, countedQuantity: v.countedQuantity, reason: v.reason }));

const yearText = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d{4}$/.test(v) && Number(v) >= 1950 && Number(v) <= 2100), 'Ano inválido')
  .transform((v) => (v === '' ? null : Number(v)));

export const partApplicationFormSchema = z
  .object({
    make: z.string().trim().min(1, 'Informe a marca').max(60),
    model: optionalText(80),
    engine: optionalText(40),
    yearFrom: yearText,
    yearTo: yearText,
    notes: optionalText(200),
  })
  .refine((v) => !v.yearFrom || !v.yearTo || v.yearTo >= v.yearFrom, {
    path: ['yearTo'],
    message: 'O ano final vem depois do inicial',
  });

/** Aba "Preços e estoque" das configurações. */
export const pricingSettingsFormSchema = z
  .object({
    laborRate: moneyText,
    defaultMarkup: z
      .string()
      .trim()
      .refine((v) => {
        const bps = parsePercent(v);
        return bps !== null && bps <= 100_000;
      }, 'Percentual inválido. Ex.: 30 ou 12,5')
      .transform((v) => parsePercent(v)!),
  })
  .transform((v) => ({ laborRateCents: v.laborRate, defaultMarkupBps: v.defaultMarkup }));

export type StockEntryForm = z.input<typeof stockEntryFormSchema>;
export type StockAdjustmentForm = z.input<typeof stockAdjustmentFormSchema>;
export type PartApplicationForm = z.input<typeof partApplicationFormSchema>;
export type PricingSettingsForm = z.input<typeof pricingSettingsFormSchema>;
export type ServiceForm = z.input<typeof serviceFormSchema>;
export type ServiceInput = z.output<typeof createServiceSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type PartCategory = z.infer<typeof partCategorySchema>;
export type PartForm = z.input<typeof partFormSchema>;
export type PartInput = z.output<typeof createPartSchema>;
export type Part = z.infer<typeof partSchema>;
export type PartListItem = z.infer<typeof partListItemSchema>;
export type PartApplication = z.infer<typeof partApplicationSchema>;
export type PartApplicationInput = z.input<typeof partApplicationInputSchema>;
export type StockMovementInput = z.input<typeof stockMovementInputSchema>;
export type Movement = z.infer<typeof movementSchema>;
export type InventorySummary = z.infer<typeof inventorySummarySchema>;
