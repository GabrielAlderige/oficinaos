import type { AttentionGroup } from '@oficinaos/shared';
import { AlertTriangle, ArrowRight, CircleAlert, Info } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardHeader, Skeleton } from '../../components/ui/display';
import { cn } from '../../lib/cn';
import { useAttention } from './api';

/**
 * A cor NUNCA carrega o recado sozinha: cada grupo tem ícone e título escritos.
 * Quem não distingue as cores, ou está no modo de alto contraste, lê a mesma
 * informação.
 */
const TOM = {
  danger: { icon: CircleAlert, classe: 'bg-danger-soft text-danger' },
  warning: { icon: AlertTriangle, classe: 'bg-warning-soft text-warning' },
  info: { icon: Info, classe: 'bg-info-soft text-info' },
} as const;

function Grupo({ grupo }: { grupo: AttentionGroup }) {
  const { icon: Icone, classe } = TOM[grupo.tone];
  const restantes = grupo.count - grupo.items.length;
  return (
    <li className="px-5 py-4">
      <div className="flex items-start gap-3">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', classe)} aria-hidden="true">
          <Icone className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {grupo.title}
            <span className="ml-1.5 text-muted">({grupo.count})</span>
          </p>
          <ul className="mt-1.5 space-y-1">
            {grupo.items.map((item) => (
              <li key={item.id} className="text-sm">
                <Link to={item.to} className="hover:text-accent hover:underline">
                  {item.label}
                </Link>
                {item.detail && <span className="text-muted"> — {item.detail}</span>}
              </li>
            ))}
          </ul>
          {restantes > 0 && grupo.to && (
            <Link to={grupo.to} className="mt-1.5 inline-flex items-center gap-1 text-sm text-accent hover:underline">
              e mais {restantes}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * "Atenção necessária": o que está travado ou escapando, com caminho para
 * resolver. Some da tela quando não há nada — oficina em dia não precisa de um
 * painel dizendo que está tudo bem.
 */
export function AttentionPanel() {
  const atencao = useAttention();

  if (atencao.isPending) {
    return (
      <Card className="space-y-3 p-5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }
  if (!atencao.data?.length) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Atenção necessária"
        description="O que está parado ou escapando, e onde resolver."
      />
      <ul className="divide-y divide-border border-t border-border">
        {atencao.data.map((grupo) => (
          <Grupo key={grupo.key} grupo={grupo} />
        ))}
      </ul>
    </Card>
  );
}
