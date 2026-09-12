import type { z } from 'zod';
import type { Notification, NotificationList, notificationListQuerySchema } from '@oficinaos/shared';
import type { AuthContext, ServiceDeps } from '../../core/auth-context';
import { isoOrNull } from '../../core/normalize';
import { withTenant } from '../../db/tenant';
import * as repo from './notifications.repository';

type ListQuery = z.output<typeof notificationListQuerySchema>;

const toDto = (row: repo.NotificationRow): Notification => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  link: row.link,
  readAt: isoOrNull(row.readAt),
  createdAt: row.createdAt.toISOString(),
});

/**
 * Avisos do painel. Quem cria é o fluxo do orçamento (fan-out por pessoa); aqui
 * só se lê e se marca como lido. Não há permissão própria: o aviso é de quem o
 * recebeu, e qualquer pessoa logada vê a sua própria caixa.
 */
export class NotificationsService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, query: ListQuery): Promise<NotificationList> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const rows = await repo.listForUser(tx, auth.organizationId, auth.userId, query.limit);
      return {
        data: rows.map(toDto),
        unreadCount: await repo.countUnread(tx, auth.organizationId, auth.userId),
      };
    });
  }

  async markAllRead(auth: AuthContext): Promise<NotificationList> {
    return withTenant(this.deps.db, auth, async (tx) => {
      await repo.markAllRead(tx, auth.organizationId, auth.userId);
      const rows = await repo.listForUser(tx, auth.organizationId, auth.userId, 20);
      return { data: rows.map(toDto), unreadCount: 0 };
    });
  }

  async markRead(auth: AuthContext, id: string): Promise<void> {
    await withTenant(this.deps.db, auth, (tx) => repo.markRead(tx, auth.organizationId, auth.userId, id));
  }
}
