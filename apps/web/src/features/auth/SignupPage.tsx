import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema, type AuthResponse } from '@oficinaos/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { AuthHeader } from '../../app/layouts/AuthLayout';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input, PasswordInput } from '../../components/ui/input';
import { api, ApiError } from '../../lib/api-client';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { useSession } from '../../lib/session';

/** Cadastro curto (5 campos): o resto vira checklist dentro do painel. */
export function SignupPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', organizationName: '', whatsapp: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      signIn(await api<AuthResponse>('/auth/signup', { method: 'POST', json: values }));
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_ALREADY_REGISTERED') {
        setError('email', { message: err.problem?.detail ?? 'E-mail já cadastrado' });
      } else if (!applyFieldErrors(err, setError)) {
        setFormError(errorMessage(err));
      }
    }
  });

  return (
    <>
      <AuthHeader title="Crie a conta da sua oficina" description="14 dias de teste do plano Professional, sem cartão." />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert variant="danger">{formError}</Alert>}
        <Field label="Seu nome" htmlFor="name" error={errors.name?.message}>
          <Input {...fieldA11y('name', errors.name?.message)} autoComplete="name" autoFocus {...register('name')} />
        </Field>
        <Field label="Nome da oficina" htmlFor="organizationName" error={errors.organizationName?.message}>
          <Input
            {...fieldA11y('organizationName', errors.organizationName?.message)}
            autoComplete="organization"
            placeholder="Ex.: Auto Center Silva"
            {...register('organizationName')}
          />
        </Field>
        <Field label="WhatsApp da oficina" htmlFor="whatsapp" error={errors.whatsapp?.message}>
          <Input
            {...fieldA11y('whatsapp', errors.whatsapp?.message)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(11) 98765-4321"
            {...register('whatsapp')}
          />
        </Field>
        <Field label="E-mail" htmlFor="email" error={errors.email?.message}>
          <Input {...fieldA11y('email', errors.email?.message)} type="email" inputMode="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Senha" htmlFor="password" error={errors.password?.message} hint="Pelo menos 8 caracteres.">
          <PasswordInput {...fieldA11y('password', errors.password?.message, true)} autoComplete="new-password" {...register('password')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Criar conta
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Já tem conta?{' '}
        <Link to="/entrar" className="font-medium text-accent hover:underline dark:text-accent-bright">
          Entrar
        </Link>
      </p>
    </>
  );
}
