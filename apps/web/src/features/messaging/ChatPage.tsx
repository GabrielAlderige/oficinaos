import type { ChatMessage, ConversationSummary, MessagePreview, QuickReply } from '@oficinaos/shared';
import { MESSAGE_STATUS_LABELS } from '@oficinaos/shared';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  ExternalLink,
  Info,
  MessageSquare,
  Send,
  TriangleAlert,
  User,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Avatar, Badge, Skeleton } from '../../components/ui/display';
import { SearchInput } from '../../components/ui/list-parts';
import { cn } from '../../lib/cn';
import { displayPhone } from '../../lib/contact';
import { errorMessage } from '../../lib/errors';
import { formatRelative } from '../../lib/format';
import {
  useConversation,
  useConversations,
  useMarkConversationRead,
  useMessageTemplates,
  useSendMessage,
} from './api';

/**
 * Conversa pelo OficinaOS (E22, redesenhada na E23).
 *
 * A tela ocupa o painel inteiro porque é onde a pessoa do balcão passa o dia:
 * a lista de contatos à esquerda, o fio à direita, e a página não rola — quem
 * rola é o fio, como em qualquer aplicativo de conversa.
 *
 * O que ela faz de diferente de um WhatsApp Web:
 * 1. diz, em cima do campo de texto, **o que dá para enviar agora** (a janela
 *    de 24 h da Meta fecha sozinha, e ninguém tem como adivinhar);
 * 2. tem as **respostas prontas** do dia a dia da oficina a um toque — elas
 *    escrevem no campo, e quem manda continua sendo a pessoa.
 */
export function ChatPage() {
  const [params, setParams] = useSearchParams();
  const escolhida = params.get('cliente');
  const escolher = (customerId: string | null) => {
    const proximo = new URLSearchParams(params);
    if (customerId) proximo.set('cliente', customerId);
    else proximo.delete('cliente');
    setParams(proximo, { replace: true });
  };

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* no celular, ou a lista ou o fio: dois painéis lado a lado não cabem */}
      <aside
        className={cn(
          'flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs lg:w-80 xl:w-96',
          escolhida && 'hidden lg:flex',
        )}
      >
        <ListaDeConversas escolhida={escolhida} onEscolher={escolher} />
      </aside>

      <section
        className={cn(
          'min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface shadow-xs',
          !escolhida && 'hidden lg:block',
        )}
      >
        {escolhida ? (
          <Fio customerId={escolhida} onVoltar={() => escolher(null)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-surface-muted text-muted">
              <MessageSquare className="size-6" aria-hidden="true" />
            </span>
            <p className="font-medium">Escolha uma conversa</p>
            <p className="max-w-sm text-sm text-muted">
              À esquerda ficam os clientes com quem você já falou. Para começar uma conversa nova, abra o cliente e
              toque em <strong>Conversar</strong>.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------- a lista -----------------------------------

function ListaDeConversas({
  escolhida,
  onEscolher,
}: {
  escolhida: string | null;
  onEscolher(customerId: string): void;
}) {
  const lista = useConversations();
  const [busca, setBusca] = useState('');

  const conversas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return lista.data ?? [];
    return (lista.data ?? []).filter((conversa) => conversa.customerName.toLowerCase().includes(termo));
  }, [lista.data, busca]);

  const naoLidas = (lista.data ?? []).reduce((soma, conversa) => soma + conversa.unread, 0);

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold tracking-tight">Conversas</h1>
        {naoLidas > 0 && <Badge tone="accent">{naoLidas} não lidas</Badge>}
      </div>
      <div className="border-b border-border p-2">
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar cliente" label="Buscar conversa" />
      </div>

      {lista.isPending ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : lista.isError ? (
        <div className="p-3">
          <Alert variant="danger">{errorMessage(lista.error)}</Alert>
        </div>
      ) : !conversas.length ? (
        <p className="px-6 py-10 text-center text-sm text-muted">
          {busca
            ? 'Nenhum cliente com esse nome.'
            : 'Nenhuma conversa ainda. Abra um cliente e mande a primeira mensagem.'}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversas">
          {conversas.map((conversa) => (
            <li key={conversa.customerId}>
              <ItemDaLista
                conversa={conversa}
                ativa={conversa.customerId === escolhida}
                onEscolher={() => onEscolher(conversa.customerId)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ItemDaLista({
  conversa,
  ativa,
  onEscolher,
}: {
  conversa: ConversationSummary;
  ativa: boolean;
  onEscolher: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEscolher}
      aria-current={ativa ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 border-l-2 px-3 py-2.5 text-left transition-colors',
        ativa ? 'border-l-accent bg-accent-soft/60' : 'border-l-transparent hover:bg-surface-muted',
      )}
    >
      <Avatar name={conversa.customerName} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{conversa.customerName}</span>
          <span className="shrink-0 text-[11px] text-muted">
            {conversa.lastMessageAt && formatRelative(conversa.lastMessageAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-xs', conversa.unread > 0 ? 'text-foreground' : 'text-muted')}>
            {conversa.lastDirection === 'OUTBOUND' && <span className="text-muted">Você: </span>}
            {conversa.lastPreview ?? 'Sem mensagens'}
          </span>
          {conversa.unread > 0 && (
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white">
              {conversa.unread}
            </span>
          )}
        </span>
        {conversa.windowOpen && (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-success">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            respondeu nas últimas 24 h
          </span>
        )}
      </span>
    </button>
  );
}

// -------------------------------- o fio ------------------------------------

function Fio({ customerId, onVoltar }: { customerId: string; onVoltar(): void }) {
  const conversa = useConversation(customerId);
  const marcarLida = useMarkConversationRead(customerId);
  const naoLidas = useConversations().data?.find((c) => c.customerId === customerId)?.unread ?? 0;
  const fim = useRef<HTMLDivElement>(null);
  const quantidade = conversa.data?.messages.length ?? 0;

  // abrir a conversa é ler a conversa
  useEffect(() => {
    if (naoLidas > 0) marcarLida.mutate();
    // a intenção é "quando abrir esta conversa com não lidas", não a cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, naoLidas > 0]);

  // mensagem nova puxa o fio para baixo, como em qualquer conversa
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [customerId, quantidade]);

  if (conversa.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (conversa.isError) {
    return (
      <div className="p-4">
        <Alert variant="danger">{errorMessage(conversa.error)}</Alert>
      </div>
    );
  }

  const dados = conversa.data;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 lg:hidden"
          onClick={onVoltar}
          aria-label="Voltar para a lista"
        >
          <ArrowLeft />
        </Button>
        <Avatar name={dados.customerName} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{dados.customerName}</p>
          <p className="truncate text-xs text-muted">
            {dados.phone ? displayPhone(dados.phone) : 'sem WhatsApp no cadastro'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <SeloDaJanela conversa={dados} />
          <Button asChild variant="ghost" size="sm" title="Abrir a ficha do cliente">
            <Link to={`/clientes/${customerId}`}>
              <User />
              <span className="sr-only sm:not-sr-only">Ficha</span>
            </Link>
          </Button>
          {dados.whatsappUrl && (
            <Button asChild variant="ghost" size="sm" title="Abrir no WhatsApp">
              <a href={dados.whatsappUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                <span className="sr-only sm:not-sr-only">WhatsApp</span>
              </a>
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-muted/40 px-4 py-4">
        {/* conversa curta encosta embaixo, perto de onde se escreve */}
        <div className="flex min-h-full flex-col justify-end">
        {dados.messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            Nenhuma mensagem com este cliente ainda. Use uma resposta pronta aqui embaixo para começar.
          </p>
        ) : (
          <ol className="space-y-1" aria-label={`Mensagens com ${dados.customerName}`}>
            {dados.messages.map((mensagem, indice) => {
              const anterior = dados.messages[indice - 1];
              const mudouODia = !anterior || !mesmoDia(anterior.createdAt, mensagem.createdAt);
              return (
                <li key={mensagem.id}>
                  {mudouODia && <SeparadorDeDia iso={mensagem.createdAt} />}
                  <Balao mensagem={mensagem} />
                </li>
              );
            })}
          </ol>
        )}
        <div ref={fim} />
        </div>
      </div>

      <Composer
        customerId={customerId}
        podeTextoLivre={dados.canSendFreeText || !dados.channelConnected}
        motivo={dados.windowReason}
      />
    </div>
  );
}

function SeloDaJanela({ conversa }: { conversa: { channelConnected: boolean; canSendFreeText: boolean } }) {
  if (!conversa.channelConnected) return <Badge>Pelo link</Badge>;
  return conversa.canSendFreeText ? (
    <Badge tone="success">Conversa aberta</Badge>
  ) : (
    <Badge tone="warning">Só modelo</Badge>
  );
}

const mesmoDia = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

const diaFormatado = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const horaFormatada = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function SeparadorDeDia({ iso }: { iso: string }) {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86_400_000);
  const rotulo =
    data.toDateString() === hoje.toDateString()
      ? 'Hoje'
      : data.toDateString() === ontem.toDateString()
        ? 'Ontem'
        : diaFormatado.format(data);

  return (
    <div className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted">{rotulo}</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

function Balao({ mensagem }: { mensagem: ChatMessage }) {
  const minha = mensagem.direction === 'OUTBOUND';
  return (
    <div className={cn('flex py-0.5', minha ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line shadow-xs sm:max-w-[68%]',
          minha ? 'rounded-br-sm bg-accent-soft text-foreground' : 'rounded-bl-sm border border-border bg-surface',
        )}
      >
        {mensagem.body}
        <p className={cn('mt-1 flex items-center gap-1.5 text-[11px] text-muted', minha && 'justify-end')}>
          <time dateTime={mensagem.createdAt} title={new Date(mensagem.createdAt).toLocaleString('pt-BR')}>
            {horaFormatada.format(new Date(mensagem.createdAt))}
          </time>
          {mensagem.sentByName && <span className="truncate">· {mensagem.sentByName}</span>}
          {minha && <Situacao status={mensagem.status} />}
        </p>
        {mensagem.failureReason && (
          <p className="mt-1 flex items-start gap-1.5 text-[11px] text-danger">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            {mensagem.failureReason}
          </p>
        )}
      </div>
    </div>
  );
}

/** O que o WhatsApp confirmou. Sem a API oficial, o máximo é "link aberto". */
function Situacao({ status }: { status: ChatMessage['status'] }) {
  const rotulo = MESSAGE_STATUS_LABELS[status];
  if (status === 'READ') {
    return (
      <span className="flex items-center text-accent" title={rotulo}>
        <CheckCheck className="size-3.5" aria-hidden="true" />
        <span className="sr-only">{rotulo}</span>
      </span>
    );
  }
  if (status === 'DELIVERED' || status === 'SENT') {
    return (
      <span className="flex items-center" title={rotulo}>
        {status === 'DELIVERED' ? (
          <CheckCheck className="size-3.5" aria-hidden="true" />
        ) : (
          <Check className="size-3.5" aria-hidden="true" />
        )}
        <span className="sr-only">{rotulo}</span>
      </span>
    );
  }
  return <span className={cn(status === 'FAILED' && 'text-danger')}>· {rotulo}</span>;
}

// ------------------------------ o composer ---------------------------------

function Composer({
  customerId,
  podeTextoLivre,
  motivo,
}: {
  customerId: string;
  podeTextoLivre: boolean;
  motivo: string;
}) {
  const [texto, setTexto] = useState('');
  const [painel, setPainel] = useState<'respostas' | 'modelos' | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const enviar = useSendMessage(customerId);
  const ajuda = useMessageTemplates(customerId);

  // o campo cresce com o texto até caber seis linhas, e volta quando esvazia
  useEffect(() => {
    const elemento = campo.current;
    if (!elemento) return;
    elemento.style.height = 'auto';
    elemento.style.height = `${Math.min(elemento.scrollHeight, 160)}px`;
  }, [texto]);

  const mandar = async (corpo: { body: string } | { templateKey: MessagePreview['templateKey'] }) => {
    try {
      const resultado = await enviar.mutateAsync({ ...corpo, clientRequestId: crypto.randomUUID() });
      if (resultado.repeated) {
        toast.info('Essa mensagem já havia sido enviada.');
        return;
      }
      if (resultado.whatsappUrl) {
        // sem canal conectado, quem aperta enviar é a pessoa: a aba abre com o
        // texto pronto
        window.open(resultado.whatsappUrl, '_blank', 'noreferrer');
        toast.success('Texto pronto no WhatsApp. Confira e aperte enviar.');
      } else {
        toast.success('Mensagem enviada.');
      }
      setTexto('');
      setPainel(null);
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  };

  /** Resposta pronta não sai sozinha: ela escreve no campo e devolve o cursor. */
  const usarResposta = (body: string) => {
    setTexto(body);
    setPainel(null);
    requestAnimationFrame(() => {
      campo.current?.focus();
      campo.current?.setSelectionRange(body.length, body.length);
    });
  };

  return (
    <div className="border-t border-border">
      {painel === 'respostas' && (
        <RespostasProntas
          respostas={ajuda.data?.quickReplies ?? []}
          carregando={ajuda.isPending}
          onUsar={usarResposta}
        />
      )}
      {painel === 'modelos' && (
        <ModelosProntos
          modelos={ajuda.data?.templates ?? []}
          carregando={ajuda.isPending}
          enviando={enviar.isPending}
          onEnviar={(templateKey) => void mandar({ templateKey })}
        />
      )}

      <p
        className={cn(
          'flex items-start gap-1.5 px-3 pt-2 text-[11px]',
          podeTextoLivre ? 'text-muted' : 'text-warning',
        )}
      >
        <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
        {motivo}
      </p>

      <div className="flex items-center gap-2 px-3 pt-1.5">
        <Button
          size="sm"
          variant={painel === 'respostas' ? 'secondary' : 'ghost'}
          aria-expanded={painel === 'respostas'}
          onClick={() => setPainel(painel === 'respostas' ? null : 'respostas')}
        >
          <Zap />
          Respostas prontas
        </Button>
        <Button
          size="sm"
          variant={painel === 'modelos' ? 'secondary' : 'ghost'}
          aria-expanded={painel === 'modelos'}
          onClick={() => setPainel(painel === 'modelos' ? null : 'modelos')}
        >
          <Clock />
          Modelos
        </Button>
      </div>

      <div className="flex items-end gap-2 p-3">
        <textarea
          ref={campo}
          aria-label="Mensagem"
          rows={1}
          placeholder={
            podeTextoLivre
              ? 'Escreva a mensagem…  (Enter envia, Shift+Enter pula linha)'
              : 'Fora da janela de 24 h, só modelo aprovado.'
          }
          value={texto}
          disabled={!podeTextoLivre}
          onChange={(event) => setTexto(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (texto.trim()) void mandar({ body: texto.trim() });
            }
          }}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted"
        />
        <Button
          size="icon"
          className="size-10 shrink-0 rounded-xl"
          disabled={!podeTextoLivre || !texto.trim() || enviar.isPending}
          onClick={() => void mandar({ body: texto.trim() })}
          aria-label="Enviar mensagem"
        >
          <Send />
        </Button>
      </div>
    </div>
  );
}

/**
 * O que a oficina digita o dia inteiro, agrupado pela etapa do atendimento.
 * Um toque escreve no campo; quem manda continua sendo a pessoa.
 */
function RespostasProntas({
  respostas,
  carregando,
  onUsar,
}: {
  respostas: QuickReply[];
  carregando: boolean;
  onUsar(body: string): void;
}) {
  const grupos = useMemo(() => [...new Set(respostas.map((resposta) => resposta.grupo))], [respostas]);
  const [grupo, setGrupo] = useState<string | null>(null);
  const atual = grupo && grupos.includes(grupo) ? grupo : (grupos[0] ?? null);

  if (carregando) {
    return (
      <div className="p-3">
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (!respostas.length) return null;

  return (
    <div className="max-h-72 overflow-y-auto border-b border-border bg-surface-muted/40 p-3">
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Etapa do atendimento">
        {grupos.map((nome) => (
          <button
            key={nome}
            type="button"
            aria-pressed={nome === atual}
            onClick={() => setGrupo(nome)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
              nome === atual
                ? 'border-accent-bright bg-accent-soft font-medium text-foreground'
                : 'border-border text-muted hover:text-foreground',
            )}
          >
            {nome}
          </button>
        ))}
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {respostas
          .filter((resposta) => resposta.grupo === atual)
          .map((resposta) => (
            <li key={resposta.key}>
              <button
                type="button"
                onClick={() => onUsar(resposta.body)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-accent-bright hover:bg-accent-soft/40"
              >
                <span className="block text-xs font-medium">{resposta.titulo}</span>
                <span className="mt-0.5 block text-xs text-muted">{resposta.body}</span>
              </button>
            </li>
          ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">
        A resposta escreve no campo abaixo — você lê, ajusta se quiser, e manda.
      </p>
    </div>
  );
}

/**
 * Os modelos escritos pelo sistema. Diferente das respostas prontas, eles saem
 * **mesmo fora da janela de 24 h** quando estão aprovados na Meta — e por isso
 * vão direto, sem passar pelo campo de texto.
 */
function ModelosProntos({
  modelos,
  carregando,
  enviando,
  onEnviar,
}: {
  modelos: MessagePreview[];
  carregando: boolean;
  enviando: boolean;
  onEnviar(key: MessagePreview['templateKey']): void;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  const escolhido = useMemo(() => modelos.find((m) => m.templateKey === aberto), [modelos, aberto]);

  if (carregando) {
    return (
      <div className="p-3">
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (!modelos.length) return null;

  return (
    <div className="max-h-72 overflow-y-auto border-b border-border bg-surface-muted/40 p-3">
      <div className="flex flex-wrap gap-1.5">
        {modelos.map((modelo) => (
          <button
            key={modelo.templateKey}
            type="button"
            aria-expanded={aberto === modelo.templateKey}
            onClick={() => setAberto(aberto === modelo.templateKey ? null : modelo.templateKey)}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
              aberto === modelo.templateKey
                ? 'border-accent-bright bg-accent-soft font-medium text-foreground'
                : 'border-border text-muted hover:text-foreground',
            )}
          >
            {ROTULOS[modelo.templateKey] ?? modelo.templateKey}
            <ChevronDown
              className={cn('size-3 transition-transform', aberto === modelo.templateKey && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>

      {escolhido && (
        <div
          role="group"
          aria-label={`Mensagem pronta: ${ROTULOS[escolhido.templateKey] ?? escolhido.templateKey}`}
          className="mt-2 rounded-lg border border-border bg-surface p-3"
        >
          <p className="text-sm whitespace-pre-line">{escolhido.body}</p>
          {escolhido.blocker ? (
            <Alert variant="warning" className="mt-3">
              {escolhido.blocker}
            </Alert>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={enviando || Boolean(escolhido.blocker)}
              onClick={() => onEnviar(escolhido.templateKey)}
            >
              <Send />
              Enviar esta mensagem
            </Button>
            {escolhido.whatsappUrl && (
              <Button asChild size="sm" variant="ghost">
                <a href={escolhido.whatsappUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Abrir no WhatsApp
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ROTULOS: Record<string, string> = {
  POST_SALE: 'Pós-venda',
  MAINTENANCE_DUE: 'Revisão vencendo',
  NO_RETURN: 'Cliente sem voltar',
};
