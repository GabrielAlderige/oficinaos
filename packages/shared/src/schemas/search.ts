import { z } from 'zod';
import { CUSTOMER_TYPES } from '../enums/vehicles';
import { vehicleListItemSchema } from './vehicles';

export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(100) });

/** Busca global (⌘K): no máximo 5 de cada tipo. OS e orçamentos entram na E5/E6. */
export const searchResultSchema = z.object({
  customers: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum(CUSTOMER_TYPES),
      name: z.string(),
      whatsapp: z.string().nullable(),
      vehicleCount: z.number().int(),
    }),
  ),
  vehicles: z.array(vehicleListItemSchema),
});

export type SearchResult = z.infer<typeof searchResultSchema>;
