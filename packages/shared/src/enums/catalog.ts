export const PRICING_MODES = ['FIXED', 'HOURLY'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];
export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  FIXED: 'Preço fixo',
  HOURLY: 'Por hora técnica',
};

export const PART_UNITS = ['UN', 'PAR', 'JG', 'KIT', 'L', 'ML', 'KG', 'M'] as const;
export type PartUnit = (typeof PART_UNITS)[number];
export const PART_UNIT_LABELS: Record<PartUnit, string> = {
  UN: 'Unidade',
  PAR: 'Par',
  JG: 'Jogo',
  KIT: 'Kit',
  L: 'Litro',
  ML: 'Mililitro',
  KG: 'Quilo',
  M: 'Metro',
};
/** Sigla curta ao lado da quantidade ("4,5 L", "2 un"). */
export const PART_UNIT_SHORT: Record<PartUnit, string> = {
  UN: 'un',
  PAR: 'par',
  JG: 'jg',
  KIT: 'kit',
  L: 'L',
  ML: 'mL',
  KG: 'kg',
  M: 'm',
};

/** As 11 categorias do briefing, criadas em toda oficina nova. */
export const DEFAULT_PART_CATEGORIES = [
  'Motor',
  'Freios',
  'Suspensão',
  'Elétrica',
  'Transmissão',
  'Filtros',
  'Lubrificantes',
  'Pneus',
  'Arrefecimento',
  'Direção',
  'Acessórios',
] as const;

/** Sugestões para a categoria do serviço (texto livre). */
export const SERVICE_CATEGORY_SUGGESTIONS = [
  'Revisão',
  'Diagnóstico',
  'Motor',
  'Freios',
  'Suspensão',
  'Elétrica',
  'Injeção eletrônica',
  'Arrefecimento',
  'Ar-condicionado',
  'Câmbio e embreagem',
  'Direção',
  'Alinhamento e balanceamento',
] as const;

export const MOVEMENT_TYPES = [
  'INITIAL',
  'MANUAL_IN',
  'ADJUSTMENT',
  'WORK_ORDER_OUT',
  'CUSTOMER_RETURN',
  'PURCHASE_IN',
  'SUPPLIER_RETURN',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  INITIAL: 'Estoque inicial',
  MANUAL_IN: 'Entrada',
  ADJUSTMENT: 'Ajuste de contagem',
  WORK_ORDER_OUT: 'Saída em OS',
  CUSTOMER_RETURN: 'Devolução de cliente',
  PURCHASE_IN: 'Recebimento de compra',
  SUPPLIER_RETURN: 'Devolução ao fornecedor',
};
