import { z } from 'zod';
import { CUSTOMER_TYPES } from '../enums/vehicles';
import { WORK_ORDER_STATUSES } from '../enums/work-orders';
import { vehicleListItemSchema } from './vehicles';

export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(100) });

/** Busca global (⌘K): no máximo 5 de cada tipo — clientes, carros e OS. */
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
  /** as OS do carro (ou do cliente, ou pelo número): é o que se procura no balcão */
  workOrders: z
    .array(
      z.object({
        id: z.uuid(),
        number: z.number().int(),
        status: z.enum(WORK_ORDER_STATUSES),
        customerName: z.string(),
        vehiclePlate: z.string().nullable(),
        vehicleName: z.string(),
        openedAt: z.string(),
      }),
    )
    .default([]),
});

export type SearchResult = z.infer<typeof searchResultSchema>;
