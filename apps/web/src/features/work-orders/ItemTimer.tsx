import { formatMinutesShort, type WorkOrder, type WorkOrderItem } from '@oficinaos/shared';
import { Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useStartItemTimer, useStopItemTimer } from './api';

/** Minutos desde o início da volta, arredondados para cima (como a API fecha). */
const correndoHa = (inicio: string) => Math.max(1, Math.ceil((Date.now() - Date.parse(inicio)) / 60_000));

/**
 * O cronômetro do item de serviço (E15). Um botão só: começa e para. O tempo
 * na tela conta de minuto em minuto enquanto roda — quem está com a mão no
 * carro não fica olhando segundo.
 */
export function ItemTimer({ order, item }: { order: WorkOrder; item: WorkOrderItem }) {
  const podeExecutar = useCan('work_orders:change_status');
  const iniciar = useStartItemTimer(order.id, order.number);
  const parar = useStopItemTimer(order.id, order.number);
  const [agora, setAgora] = useState(() => Date.now());

  const rodando = Boolean(item.timerStartedAt);
  useEffect(() => {
    if (!rodando) return undefined;
    const relogio = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(relogio);
  }, [rodando]);

  if (item.type !== 'SERVICE') return null;
  const encerrada = order.status === 'DELIVERED' || order.status === 'CANCELED';
  const total = item.actualMinutes + (item.timerStartedAt ? correndoHa(item.timerStartedAt) : 0);
  void agora; // o estado existe só para redesenhar o tempo em andamento

  if (encerrada && total === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      {total > 0 && (
        <span className={cn('tabular', rodando ? 'font-medium text-accent dark:text-accent-bright' : 'text-muted')}>
          {formatMinutesShort(total)}
          {item.estimatedMinutes ? ` de ${formatMinutesShort(item.estimatedMinutes)}` : ''}
          {rodando && ' · correndo'}
        </span>
      )}
      {podeExecutar && !encerrada && (
        <Button
          size="sm"
          variant={rodando ? 'secondary' : 'ghost'}
          className="h-7 px-2 text-xs"
          loading={iniciar.isPending || parar.isPending}
          onClick={async () => {
            try {
              if (rodando) {
                await parar.mutateAsync(item.id);
                toast.success('Cronômetro parado.');
              } else {
                await iniciar.mutateAsync(item.id);
              }
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
          aria-label={rodando ? `Parar o cronômetro de ${item.description}` : `Iniciar o cronômetro de ${item.description}`}
        >
          {rodando ? <Square /> : <Play />}
          {rodando ? 'Parar' : 'Iniciar'}
        </Button>
      )}
      {rodando && item.timerMechanicName && <span className="text-muted">({item.timerMechanicName})</span>}
    </span>
  );
}
