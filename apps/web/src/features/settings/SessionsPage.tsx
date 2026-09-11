import { Monitor, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { errorMessage } from '../../lib/errors';
import { describeUserAgent, formatRelative } from '../../lib/format';
import { useRevokeSession, useSessions } from './api';

export function SessionsPage() {
  const sessions = useSessions();
  const revoke = useRevokeSession();

  return (
    <Card>
      <CardHeader title="Sessões ativas" description="Aparelhos conectados à sua conta. Encerre os que você não reconhece." />
      {sessions.isPending ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : sessions.isError ? (
        <div className="p-5">
          <Alert variant="danger">{errorMessage(sessions.error)}</Alert>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.data.map((session) => {
            const device = describeUserAgent(session.userAgent);
            const Icon = device.mobile ? Smartphone : Monitor;
            const details = [
              session.organizationName,
              session.ip && `IP ${session.ip}`,
              `último uso ${formatRelative(session.lastUsedAt)}`,
            ].filter(Boolean);
            return (
              <li key={session.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-muted">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {device.label}
                    {session.current && <Badge tone="success">Este aparelho</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted">{details.join(' · ')}</p>
                </div>
                {!session.current && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={revoke.isPending && revoke.variables === session.id}
                    onClick={() =>
                      revoke.mutate(session.id, {
                        onSuccess: () => toast.success('Sessão encerrada. O aparelho precisará entrar de novo.'),
                        onError: (err) => toast.error(errorMessage(err)),
                      })
                    }
                  >
                    Encerrar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
