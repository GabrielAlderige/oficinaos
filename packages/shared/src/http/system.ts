import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

export const readyResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  database: z.enum(['ok', 'unavailable']),
  latencyMs: z.number().optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
