import { X } from 'lucide-react';
import { AlertDialog as AD, Dialog as D, DropdownMenu as DM } from 'radix-ui';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './button';

// ---- Dialog ----

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlayClass = 'fixed inset-0 z-50 bg-black/50 motion-safe:animate-[oos-fade-in_150ms_ease-out]';

export function DialogContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className={overlayClass} />
      <D.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl focus:outline-none motion-safe:animate-[oos-pop-in_160ms_ease-out]',
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          className="absolute top-4 right-4 rounded-md p-1 text-muted hover:bg-surface-muted hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-5 space-y-1 pr-8">
      <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
      {description ? (
        <D.Description className="text-sm text-muted">{description}</D.Description>
      ) : (
        <D.Description className="sr-only">{title}</D.Description>
      )}
    </div>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

// ---- Sheet (menu lateral no celular) ----

export function Sheet({ open, onOpenChange, title, children }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-xl focus:outline-none motion-safe:animate-[oos-slide-in-left_200ms_ease-out]">
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ---- Confirmação (antes de toda ação destrutiva) ----

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive = false, onConfirm }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm(): Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className={overlayClass} />
        <AD.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-xl focus:outline-none motion-safe:animate-[oos-pop-in_160ms_ease-out]">
          <AD.Title className="text-lg font-semibold tracking-tight">{title}</AD.Title>
          <AD.Description className="mt-2 text-sm text-muted">{description}</AD.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AD.Cancel asChild>
              <Button variant="secondary" disabled={busy}>
                Cancelar
              </Button>
            </AD.Cancel>
            <Button variant={destructive ? 'danger' : 'primary'} loading={busy} onClick={() => void confirm()}>
              {confirmLabel}
            </Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

// ---- Menu suspenso ----

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, align = 'end', ...props }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-48 rounded-lg border border-border bg-surface p-1 shadow-lg motion-safe:animate-[oos-fade-in_120ms_ease-out]',
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({ className, destructive, ...props }: ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted',
        destructive && 'text-danger [&_svg]:text-danger',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn('px-2 py-1.5 text-xs text-muted', className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <DM.Separator className="-mx-1 my-1 h-px bg-border" />;
}
