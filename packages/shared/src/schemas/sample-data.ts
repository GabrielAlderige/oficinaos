import { z } from 'zod';

/** Os dados de exemplo da oferta Oficina Pronta (D92): clientes, carros e serviços de mentira. */
export const sampleDataStatusSchema = z.object({
  loaded: z.boolean(),
  customers: z.number().int(),
  services: z.number().int(),
  loadedAt: z.string().nullable(),
  /** ao apagar: clientes do exemplo que ganharam OS de verdade e por isso ficaram */
  kept: z.number().int(),
});
export type SampleDataStatus = z.infer<typeof sampleDataStatusSchema>;
