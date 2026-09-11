import { zodResolver } from '@hookform/resolvers/zod';
import {
  canManageRole,
  createInvitationSchema,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
  type CreatedInvitation,
} from '@oficinaos/shared';
import { Check, Copy, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useMe } from '../../lib/session';
import { useInvite } from './api';

/**
 * Convite em dois passos: e-mail + papel → link pronto. O link aparece uma vez
 * só; na oficina ele costuma ir pelo WhatsApp na mesma hora.
 */
export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const me = useMe();
  const invite = useInvite();
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const roles = ROLES.filter((role) => canManageRole(me.role, role));
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(createInvitationSchema), defaultValues: { email: '', role: 'MECHANIC' as const } });
  const role = watch('role');

  function handleOpenChange(next: boolean) {
    if (!next) {
      setCreated(null);
      setCopied(false);
      reset();
    }
    onOpenChange(next);
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      setCreated(await invite.mutateAsync(values));
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setError('root', { message: errorMessage(err) });
    }
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }

  const whatsappText = created
    ? `Olá! Você foi convidado para a equipe da ${me.organization.name} no OficinaOS. Para aceitar, abra: ${created.inviteUrl}`
    : '';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader
              title="Convite criado"
              description={`Envie o link para ${created.email}. Ele vale por 7 dias e só pode ser usado uma vez.`}
            />
            <div className="flex gap-2">
              <Input value={created.inviteUrl} readOnly aria-label="Link do convite" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button variant="secondary" onClick={() => void copy(created.inviteUrl)} aria-label="Copiar link">
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => handleOpenChange(false)}>
                Concluir
              </Button>
              <Button asChild>
                <a href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle />
                  Enviar pelo WhatsApp
                </a>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <DialogHeader title="Convidar pessoa" description="Cada pessoa entra com o próprio acesso e vê só o que o papel permite." />
            <div className="space-y-4">
              {errors.root?.message && <Alert variant="danger">{errors.root.message}</Alert>}
              <Field label="E-mail" htmlFor="invite-email" error={errors.email?.message}>
                <Input {...fieldA11y('invite-email', errors.email?.message)} type="email" inputMode="email" autoFocus {...register('email')} />
              </Field>
              <Field label="Papel" htmlFor="invite-role" error={errors.role?.message} hint={ROLE_DESCRIPTIONS[role]}>
                <Select {...fieldA11y('invite-role', errors.role?.message, true)} {...register('role')}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Criar convite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
