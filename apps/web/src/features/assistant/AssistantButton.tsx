import type { AssistantProposal, AssistantReply } from '@oficinaos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, SendHorizontal, Sparkles, X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/input';
import { api } from '../../lib/api-client';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan, useFeature } from '../../lib/session';
import { useAssistantChat, useAssistantStatus } from './api';

interface Fala {
  role: 'user' | 'assistant';
  content: string;
  links?: AssistantReply['links'];
  proposals?: AssistantProposal[];
}

const SUGESTOES = [
  'Quais carros estão aguardando peça?',
  'Tem pastilha de freio no estoque?',
  'O que tem na agenda amanhã?',
];

/**
 * O assistente com IA (E49): um botão no topo que abre a conversa ao lado,
 * sem sair da tela. Some quando o plano não tem o assistente ou quando o
 * servidor está sem a chave da IA.
 */
export function AssistantButton() {
  const temNoPlano = useFeature('assistant');
  const status = useAssistantStatus(temNoPlano);
  const [aberto, setAberto] = useState(false);

  if (!temNoPlano || !status.data?.enabled) return null;

  return (
    <D.Root open={aberto} onOpenChange={setAberto}>
      <D.Trigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Abrir o assistente">
          <Sparkles className="text-accent" />
          <span className="hidden md:inline">Assistente</span>
        </Button>
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <D.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-xl focus:outline-none">
          <Conversa onClose={() => setAberto(false)} restantes={status.data.remainingToday} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Conversa({ onClose, restantes }: { onClose(): void; restantes: number }) {
  const chat = useAssistantChat();
  const [falas, setFalas] = useState<Fala[]>([]);
  const [texto, setTexto] = useState('');
  const fim = useRef<HTMLDivElement>(null);

  // chaves de propósito: no Chrome novo o scrollIntoView devolve uma Promise, e
  // o useEffect quebra se receber qualquer coisa que não seja função de limpeza
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [falas, chat.isPending]);

  async function enviar(pergunta: string) {
    const limpa = pergunta.trim();
    if (!limpa || chat.isPending) return;
    const historico: Fala[] = [...falas, { role: 'user', content: limpa }];
    setFalas(historico);
    setTexto('');
    try {
      // a conversa vai só como texto, das últimas 20 falas
      const resposta = await chat.mutateAsync({
        messages: historico.slice(-20).map(({ role, content }) => ({ role, content })),
      });
      setFalas([...historico, { role: 'assistant', content: resposta.reply, links: resposta.links, proposals: resposta.proposals }]);
    } catch (err) {
      setFalas([...historico, { role: 'assistant', content: errorMessage(err) }]);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <D.Title className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="size-4 text-accent" aria-hidden="true" />
            Assistente
          </D.Title>
          <D.Description className="text-xs text-muted">
            Pergunte sobre OS, peças, clientes e agenda. Ele consulta o sistema; cadastro, você confirma.
          </D.Description>
        </div>
        <Button variant="ghost" size="icon" aria-label="Fechar o assistente" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {!falas.length && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Experimente:</p>
            {SUGESTOES.map((sugestao) => (
              <button
                key={sugestao}
                type="button"
                onClick={() => void enviar(sugestao)}
                className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-surface-muted"
              >
                {sugestao}
              </button>
            ))}
          </div>
        )}
        {falas.map((fala, indice) => (
          <div key={indice} className={cn('flex', fala.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[90%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap',
                fala.role === 'user' ? 'bg-accent text-accent-foreground' : 'bg-surface-muted',
              )}
            >
              {fala.content}
              {!!fala.links?.length && (
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {fala.links.map((link) => (
                    <Link
                      key={`${link.href}-${link.label}`}
                      to={link.href}
                      onClick={onClose}
                      className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium hover:border-accent"
                    >
                      {link.label}
                    </Link>
                  ))}
                </span>
              )}
              {fala.proposals?.map((proposta, i) => <Proposta key={i} proposta={proposta} />)}
            </div>
          </div>
        ))}
        {chat.isPending && <p className="text-sm text-muted">Consultando o sistema…</p>}
        <div ref={fim} />
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void enviar(texto);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            aria-label="Pergunta para o assistente"
            rows={2}
            maxLength={2000}
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void enviar(texto);
              }
            }}
            placeholder="Ex.: tem filtro de óleo do Onix?"
            className="min-h-0 flex-1 resize-none"
          />
          <Button type="submit" size="icon" aria-label="Enviar" disabled={!texto.trim()} loading={chat.isPending}>
            <SendHorizontal />
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          A IA pode errar: confira antes de passar um preço ao cliente. Restam {restantes} perguntas hoje.
        </p>
      </form>
    </>
  );
}

/** O cadastro que o assistente preparou: só grava no clique, pela rota de sempre. */
function Proposta({ proposta }: { proposta: AssistantProposal }) {
  const queryClient = useQueryClient();
  const podeCliente = useCan('customers:write');
  const podeServico = useCan('catalog:write');
  const [feito, setFeito] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const pode = proposta.kind === 'customer' ? podeCliente : podeServico;

  async function confirmar() {
    setSalvando(true);
    try {
      if (proposta.kind === 'customer') {
        const criado = await api<{ id: string }>('/customers', {
          method: 'POST',
          json: { name: proposta.name, whatsapp: proposta.whatsapp, email: proposta.email },
        });
        void queryClient.invalidateQueries({ queryKey: ['customers'] });
        setFeito(`/clientes/${criado.id}`);
      } else {
        await api('/services', {
          method: 'POST',
          json: { name: proposta.name, priceCents: proposta.priceCents, estimatedMinutes: proposta.estimatedMinutes },
        });
        void queryClient.invalidateQueries({ queryKey: ['services'] });
        setFeito('/servicos');
      }
      toast.success('Cadastrado.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <span className="mt-2 block rounded-lg border border-border bg-surface p-2.5 text-foreground">
      <span className="block text-xs text-muted">{proposta.kind === 'customer' ? 'Cadastrar cliente' : 'Cadastrar serviço'}</span>
      <span className="block font-medium">{proposta.name}</span>
      <span className="block text-xs text-muted">
        {proposta.kind === 'customer'
          ? [proposta.whatsapp, proposta.email].filter(Boolean).join(' · ') || 'sem contato'
          : [
              proposta.priceCents === null ? 'sem preço' : `R$ ${(proposta.priceCents / 100).toFixed(2).replace('.', ',')}`,
              proposta.estimatedMinutes ? `${proposta.estimatedMinutes} min` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
      </span>
      {feito ? (
        <Link to={feito} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-success">
          <Check className="size-3.5" aria-hidden="true" /> Cadastrado. Abrir
        </Link>
      ) : pode ? (
        <Button size="sm" className="mt-2" loading={salvando} onClick={() => void confirmar()}>
          Confirmar cadastro
        </Button>
      ) : (
        <span className="mt-2 block text-xs text-muted">Seu papel não permite este cadastro.</span>
      )}
    </span>
  );
}
