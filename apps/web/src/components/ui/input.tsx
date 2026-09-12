import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export const inputClass =
  'h-9 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted/70 focus-visible:border-accent-bright disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 aria-[invalid=true]:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, 'h-auto min-h-20 py-2', className)} {...props} />;
}

/** Campo com prefixo/sufixo fixo ("R$", "%", "L"): a pessoa digita só o número. */
export function AdornedInput({ leading, trailing, className, ...props }: ComponentProps<'input'> & {
  leading?: string;
  trailing?: string;
}) {
  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted" aria-hidden="true">
          {leading}
        </span>
      )}
      <input className={cn(inputClass, leading && 'pl-9', trailing && 'pr-11', className)} {...props} />
      {trailing && (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted" aria-hidden="true">
          {trailing}
        </span>
      )}
    </div>
  );
}

/** Senha com botão de mostrar: no celular, digitar às cegas gera erro à toa. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input type={visible ? 'text' : 'password'} className={cn(inputClass, 'pr-10', className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-foreground"
        aria-label={visible ? 'Esconder senha' : 'Mostrar senha'}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
