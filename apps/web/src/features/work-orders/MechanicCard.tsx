import { EXECUTAM_SERVICO, type Member, type WorkOrder } from '@oficinaos/shared';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Card, CardHeader } from '../../components/ui/display';
import { Select } from '../../components/ui/field';
import { errorMessage } from '../../lib/errors';
import { useMembers } from '../settings/api';
import { useUpdateWorkOrder } from './api';

/**
 * Quem está com o carro (E30).
 *
 * Antes o mecânico só aparecia escrito na ficha do cliente, sem jeito de
 * trocar: a API aceitava desde sempre, a tela nunca deixou. É a informação
 * que faz a OS aparecer no "Minhas OS" do celular dele, então ela precisa
 * estar à mão, e não escondida atrás de um botão de editar.
 */
export function MechanicCard({ order, canWrite, editable }: {
  order: WorkOrder;
  canWrite: boolean;
  editable: boolean;
}) {
  const equipe = useMembers();
  const update = useUpdateWorkOrder(order.id);
  const podeTrocar = canWrite && editable;

  // só quem põe a mão no carro: listar o financeiro aqui é oferecer erro
  const candidatos = (equipe.data ?? []).filter(
    (membro: Member) => membro.isActive && EXECUTAM_SERVICO.includes(membro.role),
  );

  async function escolher(userId: string) {
    try {
      const salva = await update.mutateAsync({
        version: order.version,
        mechanicUserId: userId || null,
      });
      toast.success(
        salva.mechanic ? `${salva.mechanic.name} está com a OS ${salva.number}.` : 'A OS ficou sem mecânico.',
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Quem está com o carro"
        description={podeTrocar ? 'Aparece no celular dele, em Minhas OS.' : undefined}
      />
      <div className="flex items-center gap-3 px-5 pb-4">
        {order.mechanic ? (
          <Avatar name={order.mechanic.name} />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted">
            <UserPlus className="size-4" aria-hidden="true" />
          </span>
        )}

        {podeTrocar ? (
          <Select
            aria-label="Mecânico responsável pela OS"
            className="flex-1"
            value={order.mechanic?.id ?? ''}
            disabled={update.isPending || equipe.isPending}
            onChange={(evento) => void escolher(evento.target.value)}
          >
            <option value="">Ninguém ainda</option>
            {candidatos.map((membro) => (
              <option key={membro.userId} value={membro.userId}>
                {membro.name}
              </option>
            ))}
          </Select>
        ) : (
          <p className="flex-1 text-sm">{order.mechanic?.name ?? <span className="text-muted">Ninguém ainda</span>}</p>
        )}
      </div>

      {podeTrocar && !candidatos.length && !equipe.isPending && (
        <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
          Ninguém na equipe executa serviço ainda. Convide um mecânico em Configurações → Equipe.
        </p>
      )}
    </Card>
  );
}
