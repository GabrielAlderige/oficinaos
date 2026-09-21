import {
  AUTOMATION_DESCRIPTIONS,
  AUTOMATION_KEYS,
  AUTOMATION_LABELS,
  type AutomationKey,
  type AutomationsOverview,
  type AutomationSettings,
} from '@oficinaos/shared';
import { Clock, Play } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useAutomations, useRunAutomation, useUpdateAutomations } from '../automations/api';

/** Qual chave liga qual automação nas configurações. */
const CAMPO: Record<AutomationKey, keyof AutomationSettings> = {
  FOLLOW_UP_QUEUE: 'followUpQueue',
  APPOINTMENT_REMINDER: 'appointmentReminder',
  QUOTE_NO_ANSWER: 'quoteNoAnswer',
  DAILY_DIGEST: 'dailyDigest',
};

/**
 * O que o sistema faz sozinho (E21). Cada automação liga e desliga aqui, e o
 * "rodar agora" existe para a oficina VER o efeito sem esperar o amanhecer.
 */
export function AutomationsPage() {
  const visao = useAutomations();
  return visao.isPending ? (
    <Card className="space-y-4 p-6" aria-label="Carregando as automações">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </Card>
  ) : visao.isError ? (
    <Alert variant="danger">{errorMessage(visao.error)}</Alert>
  ) : (
    <Conteudo dados={visao.data} />
  );
}

function Conteudo({ dados }: { dados: AutomationsOverview }) {
  const salvar = useUpdateAutomations();
  const rodar = useRunAutomation();
  const [dias, setDias] = useState(String(dados.settings.quoteNoAnswerDays));
  const [email, setEmail] = useState(dados.settings.digestEmail ?? '');
  /**
   * O interruptor anda na hora e volta sozinho se a gravação falhar. Caixa
   * que só mexe depois da resposta do servidor parece quebrada — e em rede de
   * oficina isso acontece o tempo todo.
   */
  const [pendente, setPendente] = useState<Partial<Record<AutomationKey, boolean>>>({});

  const alternar = async (key: AutomationKey, ligado: boolean) => {
    setPendente((atual) => ({ ...atual, [key]: ligado }));
    try {
      await salvar.mutateAsync({ [CAMPO[key]]: ligado });
      toast.success(`${AUTOMATION_LABELS[key]}: ${ligado ? 'ligada' : 'desligada'}.`);
    } catch (erro) {
      toast.error(errorMessage(erro));
    } finally {
      setPendente((atual) => {
        const { [key]: _fora, ...resto } = atual;
        return resto;
      });
    }
  };

  return (
    <div className="space-y-6">
      {!dados.settings.workerEnabled && (
        <Alert variant="warning">
          <strong>O trabalhador de fundo está desligado neste servidor.</strong> As automações continuam funcionando
          pelo botão &ldquo;Rodar agora&rdquo;, mas não acontecem sozinhas até alguém ligar o serviço.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="O que o sistema faz sozinho"
          description="Nenhuma automação manda mensagem para o cliente: ela deixa pronto, e quem envia é você."
        />
        <ul className="divide-y divide-border">
          {AUTOMATION_KEYS.map((key) => {
            const ligada = pendente[key] ?? Boolean(dados.settings[CAMPO[key]]);
            const execucao = dados.runs.find((run) => run.key === key);
            return (
              <li key={key} className="flex flex-wrap items-start gap-3 px-5 py-4">
                <label className="flex flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-accent"
                    checked={ligada}
                    onChange={(event) => void alternar(key, event.target.checked)}
                  />
                  <span>
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {AUTOMATION_LABELS[key]}
                      {execucao?.error && <Badge tone="danger">Falhou</Badge>}
                    </span>
                    <span className="block text-sm text-muted">{AUTOMATION_DESCRIPTIONS[key]}</span>
                    {execucao && (
                      <span className="mt-1 block text-xs text-muted">
                        Última vez: {formatDateTime(execucao.ranAt)} ·{' '}
                        {execucao.error
                          ? execucao.error
                          : `${execucao.created} ${execucao.created === 1 ? 'item criado' : 'itens criados'}`}
                      </span>
                    )}
                  </span>
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={rodar.isPending}
                  onClick={async () => {
                    try {
                      const resultado = await rodar.mutateAsync(key);
                      const nova = resultado.runs.find((run) => run.key === key);
                      toast.success(
                        nova?.error
                          ? nova.error
                          : `${AUTOMATION_LABELS[key]}: ${nova?.created ?? 0} ${nova?.created === 1 ? 'item criado' : 'itens criados'}.`,
                      );
                    } catch (erro) {
                      toast.error(errorMessage(erro));
                    }
                  }}
                >
                  <Play />
                  Rodar agora
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Quando e como" description="A hora é a do relógio da sua oficina." />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-3">
          <Field label="Hora de rodar" htmlFor="hora-automacao" hint="Todo dia, neste horário.">
            <Select
              {...fieldA11y('hora-automacao')}
              value={String(dados.settings.runHour)}
              onChange={async (event) => {
                try {
                  await salvar.mutateAsync({ runHour: Number(event.target.value) });
                  toast.success('Horário salvo.');
                } catch (erro) {
                  toast.error(errorMessage(erro));
                }
              }}
            >
              {Array.from({ length: 24 }, (_, hora) => (
                <option key={hora} value={hora}>
                  {String(hora).padStart(2, '0')}:00
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Orçamento parado depois de" htmlFor="dias-orcamento" hint="Dias sem resposta antes de avisar.">
            <Input
              {...fieldA11y('dias-orcamento')}
              inputMode="numeric"
              value={dias}
              onChange={(event) => setDias(event.target.value)}
              onBlur={async () => {
                const valor = Number(dias);
                if (!Number.isInteger(valor) || valor < 1 || valor > 30) {
                  toast.error('Escolha de 1 a 30 dias.');
                  setDias(String(dados.settings.quoteNoAnswerDays));
                  return;
                }
                if (valor === dados.settings.quoteNoAnswerDays) return;
                try {
                  await salvar.mutateAsync({ quoteNoAnswerDays: valor });
                  toast.success('Prazo salvo.');
                } catch (erro) {
                  toast.error(errorMessage(erro));
                }
              }}
            />
          </Field>

          <Field label="E-mail do resumo" htmlFor="email-resumo" hint="Vazio = o e-mail da oficina (ou o do dono).">
            <Input
              {...fieldA11y('email-resumo')}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={async () => {
                const valor = email.trim();
                if (valor === (dados.settings.digestEmail ?? '')) return;
                try {
                  await salvar.mutateAsync({ digestEmail: valor === '' ? null : valor });
                  toast.success('E-mail do resumo salvo.');
                } catch (erro) {
                  toast.error(errorMessage(erro));
                }
              }}
            />
          </Field>
        </div>
        <p className="flex items-start gap-2 px-5 pb-5 text-xs text-muted">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          O trabalhador acorda de hora em hora e pergunta a cada oficina se já é a hora dela — é assim que uma oficina
          em Manaus e outra em São Paulo recebem o resumo às 8 da manhã delas.
        </p>
      </Card>
    </div>
  );
}
