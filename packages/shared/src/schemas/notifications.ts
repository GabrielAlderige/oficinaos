import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../enums/quotes';

/**
 * Aviso no painel (docs/DATABASE.md §5.8). Uma linha por pessoa: "quem já leu"
 * é de cada um. O `link` é que leva ao destino — a OS pode ter sumido.
 */
export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * O sino pergunta de tempos em tempos (§8.1): a resposta traz os últimos avisos
 * e o total não lido, para não precisar de uma segunda chamada só pelo número.
 */
export const notificationListSchema = z.object({
  data: z.array(notificationSchema),
  unreadCount: z.number().int(),
});

export const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type Notification = z.infer<typeof notificationSchema>;
export type NotificationList = z.infer<typeof notificationListSchema>;
