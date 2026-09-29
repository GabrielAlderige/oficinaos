import { z } from 'zod';

/**
 * Pacote de serviço (E27): "Revisão dos 10.000 km" com os serviços e as peças
 * que ela leva.
 *
 * O pacote guarda **o que entra e quanto**, nunca o preço. O valor sai do
 * catálogo no dia em que a oficina usa, e cada linha continua editável na OS
 * — o pacote adianta a digitação, não amarra o orçamento.
 */
const quantity = z.number().positive().max(9999);

export const packageItemInputSchema = z
  .object({
    serviceId: z.uuid().nullable().default(null),
    partId: z.uuid().nullable().default(null),
    quantity: quantity.default(1),
  })
  .refine(
    (item) => Boolean(item.serviceId) !== Boolean(item.partId),
    'Cada linha do pacote é um serviço OU uma peça',
  );

export const createPackageSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome ao pacote').max(120),
  description: z.string().trim().max(500).optional(),
  items: z.array(packageItemInputSchema).min(1, 'O pacote precisa de pelo menos um item').max(40),
  isActive: z.boolean().default(true),
});

export const updatePackageSchema = createPackageSchema.partial();

/** Uma linha do pacote, já com o preço de HOJE para a tela somar. */
export const packageItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['SERVICE', 'PART']),
  refId: z.uuid(),
  name: z.string(),
  /** unidade da peça ("L", "un"); serviço vem vazio */
  unit: z.string().nullable(),
  quantity: z.number(),
  /** preço unitário atual; null quando o serviço por hora está sem hora técnica */
  unitPriceCents: z.number().int().nullable(),
  /** o item saiu do catálogo (peça excluída, serviço desativado) */
  unavailable: z.boolean(),
});

export const servicePackageSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  items: z.array(packageItemSchema),
  /** a soma do que dá para precificar hoje */
  totalCents: z.number().int(),
  createdAt: z.string(),
});

/** O que a OS recebe: o pacote inteiro, com as linhas editáveis depois. */
export const applyPackageSchema = z.object({
  packageId: z.uuid(),
  /** rede ruim repete POST: o segundo não duplica os itens (D32) */
  clientRequestId: z.uuid(),
});

export type PackageItemInput = z.output<typeof packageItemInputSchema>;
export type CreatePackageInput = z.output<typeof createPackageSchema>;
export type UpdatePackageInput = z.output<typeof updatePackageSchema>;
export type PackageItem = z.infer<typeof packageItemSchema>;
export type ServicePackage = z.infer<typeof servicePackageSchema>;
export type ApplyPackageInput = z.output<typeof applyPackageSchema>;
