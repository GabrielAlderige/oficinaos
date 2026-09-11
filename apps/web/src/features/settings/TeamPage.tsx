import { canManageRole, ROLE_LABELS, ROLES, type Invitation, type Member, type Role } from '@oficinaos/shared';
import { MoreHorizontal, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Select } from '../../components/ui/field';
import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatRelative } from '../../lib/format';
import { useCan, useMe } from '../../lib/session';
import { useInvitations, useMembers, useRemoveMember, useRevokeInvitation, useUpdateMember } from './api';
import { InviteDialog } from './InviteDialog';

type Pending =
  | { kind: 'deactivate' | 'remove'; member: Member }
  | { kind: 'revoke'; invitation: Invitation }
  | null;

export function TeamPage() {
  const me = useMe();
  const canManage = useCan('team:manage');
  const members = useMembers();
  const invitations = useInvitations(canManage);
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();
  const revokeInvitation = useRevokeInvitation();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  async function run(action: Promise<unknown>, success: string) {
    try {
      await action;
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const changeRole = (member: Member, role: Role) =>
    void run(updateMember.mutateAsync({ id: member.id, role }), `${member.name} agora é ${ROLE_LABELS[role]}.`);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Equipe"
          description="Cada pessoa entra com o próprio acesso e vê só o que o papel permite."
          action={
            canManage && (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus />
                Convidar pessoa
              </Button>
            )
          }
        />
        {members.isPending ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : members.isError ? (
          <div className="p-5">
            <Alert variant="danger">{errorMessage(members.error)}</Alert>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {members.data.map((member) => {
              const manageable = canManage && !member.isCurrentUser && canManageRole(me.role, member.role);
              return (
                <li key={member.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                    <Avatar name={member.name} className={member.isActive ? undefined : 'opacity-50'} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {member.name}
                        {member.isCurrentUser && <span className="ml-1.5 text-xs font-normal text-muted">(você)</span>}
                      </p>
                      <p className="truncate text-xs text-muted">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!member.isActive && <Badge tone="warning">Desativado</Badge>}
                    {manageable ? (
                      <Select
                        aria-label={`Papel de ${member.name}`}
                        value={member.role}
                        disabled={updateMember.isPending}
                        onChange={(e) => changeRole(member, e.target.value as Role)}
                        className="h-8 w-40 text-[13px]"
                      >
                        {ROLES.filter((r) => canManageRole(me.role, r)).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone={member.role === 'OWNER' ? 'accent' : 'neutral'}>{ROLE_LABELS[member.role]}</Badge>
                    )}
                    {manageable ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label={`Ações para ${member.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {member.isActive ? (
                            <DropdownMenuItem onSelect={() => setPending({ kind: 'deactivate', member })}>
                              <UserX />
                              Desativar acesso
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(updateMember.mutateAsync({ id: member.id, isActive: true }), `${member.name} foi reativado.`)
                              }
                            >
                              <UserCheck />
                              Reativar acesso
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem destructive onSelect={() => setPending({ kind: 'remove', member })}>
                            <Trash2 />
                            Remover da equipe
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="size-8" aria-hidden="true" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {canManage && (
        <Card>
          <CardHeader title="Convites pendentes" description="Cada link vale por 7 dias. Convidar o mesmo e-mail de novo gera um link novo." />
          {invitations.data?.length ? (
            <ul className="divide-y divide-border">
              {invitations.data.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted">
                      {ROLE_LABELS[invitation.role]}
                      {invitation.invitedByName && `, convidado por ${invitation.invitedByName}`}{' '}
                      {formatRelative(invitation.createdAt)}. Expira em {formatDate(invitation.expiresAt)}.
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setPending({ kind: 'revoke', invitation })}>
                    Revogar
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">{invitations.isPending ? 'Carregando…' : 'Nenhum convite pendente.'}</p>
          )}
        </Card>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        destructive
        title={
          pending?.kind === 'remove'
            ? `Remover ${pending.member.name} da equipe?`
            : pending?.kind === 'deactivate'
              ? `Desativar o acesso de ${pending.member.name}?`
              : 'Revogar convite?'
        }
        description={
          pending?.kind === 'remove'
            ? 'A pessoa sai da equipe e perde o acesso na hora. O histórico do que ela fez continua registrado.'
            : pending?.kind === 'deactivate'
              ? 'A pessoa perde o acesso na hora, em todos os aparelhos. Dá para reativar depois.'
              : 'O link deixa de funcionar imediatamente.'
        }
        confirmLabel={pending?.kind === 'remove' ? 'Remover' : pending?.kind === 'deactivate' ? 'Desativar' : 'Revogar'}
        onConfirm={async () => {
          if (!pending) return;
          if (pending.kind === 'revoke') await run(revokeInvitation.mutateAsync(pending.invitation.id), 'Convite revogado.');
          else if (pending.kind === 'remove') await run(removeMember.mutateAsync(pending.member.id), `${pending.member.name} saiu da equipe.`);
          else await run(updateMember.mutateAsync({ id: pending.member.id, isActive: false }), `Acesso de ${pending.member.name} desativado.`);
        }}
      />
    </div>
  );
}
