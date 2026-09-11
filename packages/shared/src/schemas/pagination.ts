import { z } from 'zod';

/** `?q=&page=1&pageSize=25` (máx. 100): toda listagem pagina no servidor (API.md §1). */
export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const pageMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const paginated = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), meta: pageMetaSchema });

export type ListQuery = z.input<typeof listQuerySchema>;
export type PageMeta = z.infer<typeof pageMetaSchema>;
export interface Page<T> {
  data: T[];
  meta: PageMeta;
}
