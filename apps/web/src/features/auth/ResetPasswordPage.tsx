import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@oficinaos/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthHeader } from '../../app/layouts/AuthLayout';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { PasswordInput } from '../../components/ui/input';
import { api, ApiError } from '../../lib/api-client';
import { applyFieldErrors, errorMessage } from '../../lib/errors';

const resetFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'As senhas não conferem', path: ['confirm'] });

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<{ message: string; expired: boolean } | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(resetFormSchema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', json: { token, password } });
      toast.success('Senha redefinida. Entre com a senha nova.');
      navigate('/entrar', { replace: true });
    } catch (err) {
      if (!applyFieldErrors(err, setError)) {
        setFormError({ message: errorMessage(err), expired: err instanceof ApiError && err.code === 'TOKEN_INVALID' });
      }
    }
  });

  return (
    <>
      <AuthHeader title="Criar senha nova" description="Por segurança, você sai de todos os aparelhos depois de trocar a senha." />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && (
          <Alert variant="danger">
            {formError.message}{' '}
            {formError.expired && (
              <Link to="/esqueci-senha" className="font-medium underline">
                Pedir um link novo
              </Link>
            )}
          </Alert>
        )}
        <Field label="Senha nova" htmlFor="password" error={errors.password?.message} hint="Pelo menos 8 caracteres.">
          <PasswordInput {...fieldA11y('password', errors.password?.message, true)} autoComplete="new-password" autoFocus {...register('password')} />
        </Field>
        <Field label="Repita a senha nova" htmlFor="confirm" error={errors.confirm?.message}>
          <PasswordInput {...fieldA11y('confirm', errors.confirm?.message)} autoComplete="new-password" {...register('confirm')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Salvar senha nova
        </Button>
      </form>
    </>
  );
}
