import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@oficinaos/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { AuthHeader } from '../../app/layouts/AuthLayout';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api-client';
import { errorMessage } from '../../lib/errors';

export function ForgotPasswordPage() {
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api<{ message: string }>('/auth/forgot-password', { method: 'POST', json: values });
      setSentMessage(res.message);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  if (sentMessage) {
    return (
      <>
        <AuthHeader title="Confira seu e-mail" />
        <Alert variant="success">{sentMessage} O link vale por 30 minutos.</Alert>
        <Button asChild variant="secondary" className="mt-6 w-full">
          <Link to="/entrar">Voltar para o login</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <AuthHeader title="Esqueci minha senha" description="Informe o e-mail da conta e enviaremos um link para criar uma senha nova." />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert variant="danger">{formError}</Alert>}
        <Field label="E-mail" htmlFor="email" error={errors.email?.message}>
          <Input {...fieldA11y('email', errors.email?.message)} type="email" inputMode="email" autoComplete="email" autoFocus {...register('email')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Enviar link
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Lembrou?{' '}
        <Link to="/entrar" className="font-medium text-accent hover:underline dark:text-accent-bright">
          Voltar para o login
        </Link>
      </p>
    </>
  );
}
