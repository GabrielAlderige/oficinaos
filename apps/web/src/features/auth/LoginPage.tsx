import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type AuthResponse } from '@oficinaos/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthHeader } from '../../app/layouts/AuthLayout';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input, PasswordInput } from '../../components/ui/input';
import { api } from '../../lib/api-client';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { safeNext } from '../../lib/format';
import { useSession } from '../../lib/session';

export function LoginPage() {
  const { signIn, state } = useSession();
  const sessionEnded = state.status === 'anonymous' && state.reason === 'session-ended';
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: params.get('email') ?? '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const response = await api<AuthResponse>('/auth/login', { method: 'POST', json: values });
      signIn(response);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      if (!applyFieldErrors(err, setError)) setFormError(errorMessage(err));
    }
  });

  return (
    <>
      <AuthHeader title="Entrar" description="Acesse o painel da sua oficina." />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {sessionEnded && !formError && <Alert variant="info">Sua sessão terminou. Entre novamente para continuar.</Alert>}
        {formError && <Alert variant="danger">{formError}</Alert>}
        <Field label="E-mail" htmlFor="email" error={errors.email?.message}>
          <Input
            {...fieldA11y('email', errors.email?.message)}
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            {...register('email')}
          />
        </Field>
        <Field
          label="Senha"
          htmlFor="password"
          error={errors.password?.message}
          aside={
            <Link to="/esqueci-senha" className="text-xs font-medium text-accent hover:underline dark:text-accent-bright">
              Esqueci minha senha
            </Link>
          }
        >
          <PasswordInput {...fieldA11y('password', errors.password?.message)} autoComplete="current-password" {...register('password')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Entrar
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Ainda não usa o OficinaOS?{' '}
        <Link to="/criar-conta" className="font-medium text-accent hover:underline dark:text-accent-bright">
          Crie a conta da sua oficina
        </Link>
      </p>
    </>
  );
}
