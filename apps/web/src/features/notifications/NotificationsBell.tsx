import type { Notification } from '@oficinaos/shared';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { useMarkAllRead, useMarkRead, useNotifications } from './api';

/**
 * É por aqui que a oficina descobre que o cliente abriu ou respondeu o
 * orçamento sem ficar recarregando a tela (ARCHITECTURE §8.1).
 */
export function NotificationsBell() {
  const navigate = useNavigate();
  const notifications = useNotifications();
  const markAll = useMarkAllRead();
  const markOne = useMarkRead();

  const data = notifications.data;
  const unread = data?.unreadCount ?? 0;

  function abrir(item: Notification) {
    if (!item.readAt) markOne.mutate(item.id);
    if (item.link) navigate(item.link);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Avisos: ${unread} não lidos` : 'Avisos'}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          Avisos
          {unread > 0 && (
            <button
              type="button"
              className="text-xs font-normal text-muted hover:text-foreground"
              onClick={() => markAll.mutate()}
            >
              Marcar todos como lidos
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {!data?.data.length ? (
          <p className="px-3 py-6 text-center text-sm text-muted">
            Nada ainda. Quando o cliente abrir ou responder um orçamento, aparece aqui.
          </p>
        ) : (
          data.data.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => abrir(item)}
              className={cn('flex-col items-start gap-0.5', !item.readAt && 'bg-accent-soft/40')}
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                {!item.readAt && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
              </span>
              {item.body && <span className="w-full text-xs text-muted">{item.body}</span>}
              <span className="text-xs text-muted">{formatRelative(item.createdAt)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
