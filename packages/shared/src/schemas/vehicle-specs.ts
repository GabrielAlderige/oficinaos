import { z } from 'zod';
import { SPEC_GROUPS } from '../enums/vehicle-specs';

/**
 * Ficha do carro (E31): o catálogo de aplicação da PLATAFORMA.
 *
 * Diferente de tudo o mais no sistema, este dado não é de nenhuma oficina —
 * é nosso, e todas as oficinas leem o mesmo. Por isso as fichas nascem
 * rascunho e só aparecem para a oficina quando publicadas: meia ficha publicada
 * é pior que ficha nenhuma, porque o mecânico confia no que está escrito.
 */
const ano = z.number().int().min(1950).max(2100);

export const vehicleSpecValueSchema = z.object({
  /** chave de SPEC_ITEMS, ou vazia quando é um item extra deste carro */
  key: z.string().trim().max(60).default(''),
  /** rótulo próprio: só para item que não está na lista fixa */
  customLabel: z.string().trim().max(80).default(''),
  group: z.enum(SPEC_GROUPS),
  value: z.string().trim().min(1, 'Escreva a especificação').max(300),
  /** observação curta: "trocar junto com a correia", "só na versão 1.6" */
  note: z.string().trim().max(200).default(''),
  /**
   * De ONDE veio este valor (E35): "Manual do proprietário Gol 2022, pág. 216".
   *
   * Sem isto o catálogo é palpite com cara de certeza. Com isto, quem preenche
   * sabe o que já foi conferido, quem lê sabe em que confiar, e uma informação
   * errada tem como ser rastreada até a origem. Campo vazio aparece na tela
   * como "sem fonte" — que é um aviso, não um detalhe.
   */
  source: z.string().trim().max(200).default(''),
});

export const catalogVehicleFieldsSchema = z.object({
  make: z.string().trim().min(2, 'Informe a marca').max(60),
  model: z.string().trim().min(1, 'Informe o modelo').max(80),
  /** "1.0 8V", "G6 1.6 MSI" — o que separa uma ficha da outra */
  version: z.string().trim().max(80).default(''),
  yearFrom: ano.nullable().default(null),
  yearTo: ano.nullable().default(null),
  notes: z.string().trim().max(1000).default(''),
});

export const createCatalogVehicleSchema = catalogVehicleFieldsSchema.extend({
  specs: z.array(vehicleSpecValueSchema).max(120).default([]),
  isPublished: z.boolean().default(false),
});

/**
 * Atualização: campos OPCIONAIS e sem padrão.
 *
 * `createCatalogVehicleSchema.partial()` parece o caminho óbvio e é uma
 * armadilha: `.partial()` deixa a chave opcional, mas o `.default()` de dentro
 * continua valendo — então um PATCH de `{ isPublished: true }` chegava ao
 * serviço com `version: ''`, `yearFrom: null` e despublicava a ficha ao mesmo
 * tempo. Aqui cada campo é declarado à mão: o que não veio fica `undefined`,
 * e o serviço sabe que `undefined` é "não mexer".
 */
export const updateCatalogVehicleSchema = z.object({
  make: z.string().trim().min(2, 'Informe a marca').max(60).optional(),
  model: z.string().trim().min(1, 'Informe o modelo').max(80).optional(),
  version: z.string().trim().max(80).optional(),
  yearFrom: ano.nullable().optional(),
  yearTo: ano.nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
  specs: z.array(vehicleSpecValueSchema).max(120).optional(),
  isPublished: z.boolean().optional(),
});

export const catalogVehicleSchema = catalogVehicleFieldsSchema.extend({
  id: z.uuid(),
  specs: z.array(vehicleSpecValueSchema.extend({ updatedAt: z.string() })),
  isPublished: z.boolean(),
  /** quantos itens da ficha já têm resposta: é o que a oficina vê como "completa" */
  filledCount: z.number().int(),
  updatedAt: z.string(),
});

/** O resumo da busca: sem as specs, para a lista não carregar o catálogo inteiro. */
export const catalogVehicleSummarySchema = catalogVehicleFieldsSchema.extend({
  id: z.uuid(),
  isPublished: z.boolean(),
  filledCount: z.number().int(),
  updatedAt: z.string(),
});

export const catalogSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** só o administrador da plataforma enxerga rascunho */
  incluirRascunhos: z.stringbool().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * "Não achei o meu carro" (E31). Vira a fila de prioridade de quem preenche:
 * o carro mais pedido é o próximo a ser feito.
 */
export const requestCatalogVehicleSchema = z.object({
  make: z.string().trim().min(1, 'Informe a marca').max(60),
  model: z.string().trim().min(1, 'Informe o modelo').max(80),
  year: ano.nullable().default(null),
  note: z.string().trim().max(300).default(''),
});

export const catalogVehicleRequestSchema = requestCatalogVehicleSchema.extend({
  id: z.uuid(),
  /** quantas oficinas diferentes pediram este carro */
  requestCount: z.number().int(),
  lastRequestedAt: z.string(),
});

/** Quanto do catálogo já existe: a tela promete só o que pode cumprir. */
export const catalogCoverageSchema = z.object({
  publishedVehicles: z.number().int(),
});

export type SpecValue = z.output<typeof vehicleSpecValueSchema>;
export type CreateCatalogVehicleInput = z.output<typeof createCatalogVehicleSchema>;
export type UpdateCatalogVehicleInput = z.output<typeof updateCatalogVehicleSchema>;
export type CatalogVehicle = z.infer<typeof catalogVehicleSchema>;
export type CatalogVehicleSummary = z.infer<typeof catalogVehicleSummarySchema>;
export type CatalogVehicleRequest = z.infer<typeof catalogVehicleRequestSchema>;
export type RequestCatalogVehicleInput = z.output<typeof requestCatalogVehicleSchema>;
export type CatalogCoverage = z.infer<typeof catalogCoverageSchema>;
