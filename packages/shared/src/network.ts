import { z } from 'zod';
import { DASHBOARD_PERIODS } from './calendar';
import { ROLES } from './enums/roles';
import { quantitySchema } from './schemas/catalog';
import { optionalText } from './schemas/common';

/**
 * Várias unidades (E50): a oficina que abre a segunda casa. Cada unidade é
 * uma oficina inteira no sistema — clientes, estoque, caixa e assinatura
 * próprios, isolados como sempre. O que a REDE acrescenta:
 *
 * - abrir a unidade nova sem sair do sistema, já com o catálogo copiado;
 * - o painel da rede: o resultado de cada unidade e o total, lado a lado;
 * - transferir peça de uma unidade para a outra, pelo mesmo custo.
 *
 * A rede é quem a pessoa é DONA ou ADMINISTRADORA: o gerente de uma unidade
 * não enxerga a outra.
 */

export const NETWORK_ROLES = ['OWNER', 'ADMIN'] as const satisfies readonly (typeof ROLES)[number][];

export const createUnitSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome à unidade').max(80),
  whatsapp: optionalText(30).default(''),
  /** serviços, peças (sem estoque) e checklists da unidade atual */
  copyCatalog: z.boolean().default(true),
});
export type CreateUnitInput = z.input<typeof createUnitSchema>;

export const networkQuerySchema = z.object({
  period: z.enum(DASHBOARD_PERIODS).default('month'),
});

export const networkUnitSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.enum(ROLES),
  isCurrent: z.boolean(),
  billedCents: z.number().int(),
  receivedCents: z.number().int(),
  completedOrders: z.number().int(),
  vehiclesInShop: z.number().int(),
  stockValueCents: z.number().int().nullable(),
});
export type NetworkUnit = z.infer<typeof networkUnitSchema>;

export const networkOverviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  units: z.array(networkUnitSchema),
  totals: z.object({
    billedCents: z.number().int(),
    receivedCents: z.number().int(),
    completedOrders: z.number().int(),
    vehiclesInShop: z.number().int(),
    stockValueCents: z.number().int(),
  }),
});
export type NetworkOverview = z.infer<typeof networkOverviewSchema>;

export const stockTransferSchema = z.object({
  toOrganizationId: z.uuid(),
  items: z
    .array(
      z.object({
        partId: z.uuid(),
        quantity: quantitySchema.refine((v) => v > 0, 'A quantidade precisa ser maior que zero'),
      }),
    )
    .min(1, 'Escolha pelo menos uma peça')
    .max(50),
  notes: optionalText(300).default(''),
});
export type StockTransferInput = z.input<typeof stockTransferSchema>;

export const stockTransferResultSchema = z.object({
  transferId: z.uuid(),
  toName: z.string(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      /** a peça não existia na outra unidade: foi cadastrada lá, com o mesmo código */
      createdAtDestination: z.boolean(),
    }),
  ),
});
export type StockTransferResult = z.infer<typeof stockTransferResultSchema>;
