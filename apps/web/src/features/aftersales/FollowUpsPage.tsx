import {
  FOLLOW_UP_TYPE_HINTS,
  FOLLOW_UP_TYPE_LABELS,
  type FollowUp,
  type FollowUpType,
} from '@oficinaos/shared';
import { Check, MessageCircle, PhoneOff, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { EmptyState } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useCloseFollowUp, useFollowUps } from './api';

const FILTROS = [
  { valor: 'today', rotulo: 'Hoje' },
  { valor: 'week', rotulo: 'Próximos 7 dias' },
  { valor: 'done', rotulo: 'Já contatados' },
  { valor: 'all', rotulo: 'Todos' },
] as const;

const TOM: Record<FollowUpType, 'success' | 'info' | 'warning'> = {
  POST_SALE_7D: 'success',
  MAINTENANCE_DUE: 'info',
  NO_RETURN_6M: 'warning',
};

/**
 * A fila de pós-venda (E16): quem ligar hoje, por quê, e a mensagem pronta.
 *
 * O envio é **assistido**: o botão abre o WhatsApp com o texto escrito, e quem
 * aperta enviar é a pessoa. Nada sai sozinho — é o que o briefing pede e o que
 * as regras do WhatsApp permitem sem API oficial.
 */
export function FollowUpsPage() {
  const podeMexer = useCan('customers:write');
  const [params, setParams] = useSearchParams();
  const filtro = (FILTROS.find((f) => f.valor === params.get('quando'))?.valor ?? 'today') as (typeof FILTROS)[number]['valor'];
  const fila = useFollowUps(filtro);
  const dados = fila.data;

  return (
    <>
      <PageHeader
        title="Pós-venda"
        description="Quem vale a pena chamar hoje — e o texto pronto para mandar. O que ficou para trás continua na fila."
      />

      {dados && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Tile rotulo="Vencem hoje" valor={dados.counts.today} />
          {/* atrasado continua na fila de hoje: é o contato que a oficina deixou passar */}
          <Tile rotulo="Atrasados" valor={dados.counts.late} alerta />
          <Tile rotulo="Próximos 7 dias" valor={dados.counts.week} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar a fila">
        {FILTROS.map((opcao) => {
          const ativo = opcao.valor === filtro;
          return (
            <button
              key={opcao.valor}
              type="button"
              aria-pressed={ativo}
              onClick={() => {
                const proximo = new URLSearchParams(params);
                if (opcao.valor === 'today') proximo.delete('quando');
                else proximo.set('quando', opcao.valor);
                setParams(proximo, { replace: true });
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                ativo
                  ? 'border-accent-bright bg-accent-soft font-medium text-foreground'
                  : 'border-border text-muted hover:text-foreground',
              )}
            >
              {opcao.rotulo}
            </button>
          );
        })}
      </div>

      {fila.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : fila.isError ? (
        <Alert variant="danger">{errorMessage(fila.error)}</Alert>
      ) : !dados?.data.length ? (
        <Card>
          <EmptyState
            icon={Sparkles}
            title={filtro === 'today' ? 'Nada para hoje' : 'Nada nesse filtro'}
            description="A fila se monta sozinha: uma semana depois do serviço, revisão vencendo e cliente que sumiu há seis meses."
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {dados.data.map((contato) => (
            <li key={contato.id}>
              <ContatoCard contato={contato} podeMexer={podeMexer} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Tile({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-sm text-muted">{rotulo}</p>
      <p className={cn('mt-1 text-2xl font-semibold', alerta && valor > 0 && 'text-danger')}>{valor}</p>
    </div>
  );
}

function ContatoCard({ contato, podeMexer }: { contato: FollowUp; podeMexer: boolean }) {
  const fechar = useCloseFollowUp();
  const [resultado, setResultado] = useState('');
  const [aberto, setAberto] = useState(false);
  const feito = contato.status !== 'PENDING';

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Link to={`/clientes/${contato.customerId}`} className="hover:underline">
              {contato.customerName}
            </Link>
            <Badge tone={TOM[contato.type]}>{FOLLOW_UP_TYPE_LABELS[contato.type]}</Badge>
            {contato.lateDays > 0 && <Badge tone="danger">atrasado {contato.lateDays}d</Badge>}
            {feito && <Badge tone="neutral">{contato.status === 'DONE' ? 'contatado' : 'dispensado'}</Badge>}
          </span>
        }
        description={[contato.vehicleLabel, contato.reason].filter(Boolean).join(' · ')}
      />
      <div className="space-y-3 px-5 py-4">
        <p className="rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-sm whitespace-pre-line">
          {contato.message}
        </p>
        {contato.outcome && <p className="text-sm text-muted">Resultado: {contato.outcome}</p>}

        {podeMexer && !feito && (
          <div className="flex flex-wrap items-center gap-2">
            {contato.whatsappUrl ? (
              <Button asChild size="sm">
                <a href={contato.whatsappUrl} target="_blank" rel="noreferrer noopener">
                  <MessageCircle />
                  Abrir no WhatsApp
                </a>
              </Button>
            ) : (
              <span className="text-sm text-muted">Sem WhatsApp no cadastro.</span>
            )}
            {aberto ? (
              <>
                <input
                  aria-label="O que aconteceu"
                  value={resultado}
                  onChange={(event) => setResultado(event.target.value)}
                  placeholder="Ex.: vai trazer o carro na terça"
                  className="h-8 min-w-48 flex-1 rounded-md border border-border bg-surface px-2 text-sm"
                />
                <Button
                  size="sm"
                  loading={fechar.isPending}
                  onClick={async () => {
                    try {
                      await fechar.mutateAsync({ id: contato.id, acao: 'done', outcome: resultado });
                      toast.success('Contato registrado.');
                    } catch (err) {
                      toast.error(errorMessage(err));
                    }
                  }}
                >
                  Salvar
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
                  <Check />
                  Já falei
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={fechar.isPending}
                  onClick={async () => {
                    try {
                      await fechar.mutateAsync({ id: contato.id, acao: 'skip', outcome: '' });
                      toast.success('Saiu da fila.');
                    } catch (err) {
                      toast.error(errorMessage(err));
                    }
                  }}
                >
                  <PhoneOff />
                  Não precisa
                </Button>
              </>
            )}
          </div>
        )}
        <p className="text-xs text-muted">{FOLLOW_UP_TYPE_HINTS[contato.type]}</p>
      </div>
    </Card>
  );
}
