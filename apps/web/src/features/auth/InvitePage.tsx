import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  passwordSchema,
  personNameSchema,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type AuthResponse,
  type InvitationPreview,
} from '@oficinaos/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthHeader } from '../../app/layouts/AuthLayout';
import { Button } from '../../components/ui/button';
import { Alert, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input, PasswordInput } from '../../components/ui/input';
import { api } from '../../lib/api-client';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useSession } from '../../lib/session';

export function InvitePage() {
  const { token = '' } = useParams();
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<InvitationPreview>(`/auth/invitations/${token}`),
    retry: false,
  });

  if (preview.isPending) {
    return (
      <div className="space-y-4" aria-label="Carregando convite">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (preview.isError) {
    return (
      <>
        <AuthHeader title="Convite indisponível" description={errorMessage(preview.error)} />
        <Button asChild variant="secondary" className="w-full">
          <Link to="/entrar">Ir para o login</Link>
        </Button>
      </>
    );
  }

  const invitation = preview.data;
  return (
    <>
      <AuthHeader
        title={`Entrar na equipe da ${invitation.organizationName}`}
        description={
          <>
            Você foi convidado como <strong className="text-foreground">{ROLE_LABELS[invitation.role]}</strong>.{' '}
            {ROLE_DESCRIPTIONS[invitation.role]}
          </>
        }
      />
      {invitation.existingAccount ? (
        <ExistingAccountForm token={token} invitation={invitation} />
      ) : (
        <NewAccountForm token={token} invitation={invitation} />
      )}
    </>
  );
}

function useAccept(invitation: InvitationPreview) {
  const { signIn } = useSession();
  const navigate = useNavigate();
  return async (payload: { token: string; name?: string; password: string }) => {
    signIn(await api<AuthResponse>('/auth/accept-invite', { method: 'POST', json: payload }));
    toast.success(`Bem-vindo à equipe da ${invitation.organizationName}!`);
    navigate('/', { replace: true });
  };
}

const newAccountSchema = z.object({ name: personNameSchema, password: passwordSchema });

function NewAccountForm({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const accept = useAccept(invitation);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(newAccountSchema), defaultValues: { name: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await accept({ token, ...values });
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setFormError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert variant="danger">{formError}</Alert>}
      <Field label="E-mail" htmlFor="invite-email">
        <Input id="invite-email" value={invitation.email} readOnly disabled />
      </Field>
      <Field label="Seu nome" htmlFor="name" error={errors.name?.message}>
        <Input {...fieldA11y('name', errors.name?.message)} autoComplete="name" autoFocus {...register('name')} />
      </Field>
      <Field label="Crie uma senha" htmlFor="password" error={errors.password?.message} hint="Pelo menos 8 caracteres.">
        <PasswordInput {...fieldA11y('password', errors.password?.message, true)} autoComplete="new-password" {...register('password')} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        Aceitar convite
      </Button>
    </form>
  );
}

const existingAccountSchema = z.object({ password: z.string().min(1, 'Informe sua senha') });

function ExistingAccountForm({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const accept = useAccept(invitation);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(existingAccountSchema), defaultValues: { password: '' } });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await accept({ token, password });
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Alert variant="info">
        Você já tem uma conta com <strong>{invitation.email}</strong>. Digite a senha dela para aceitar: a oficina
        nova aparece junto das que você já usa.
      </Alert>
      {formError && <Alert variant="danger">{formError}</Alert>}
      <Field label="Sua senha" htmlFor="password" error={errors.password?.message}>
        <PasswordInput {...fieldA11y('password', errors.password?.message)} autoComplete="current-password" autoFocus {...register('password')} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        Aceitar convite
      </Button>
      <p className="text-center text-sm">
        <Link to="/esqueci-senha" className="font-medium text-accent hover:underline dark:text-accent-bright">
          Esqueci minha senha
        </Link>
      </p>
    </form>
  );
}
