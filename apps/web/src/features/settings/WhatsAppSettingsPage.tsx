import {
  CHANNEL_STATUS_LABELS,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_STATUSES,
  type MessageTemplateInfo,
  type MessageTemplateKey,
  type MessagingOverview,
  type TemplateStatus,
} from '@oficinaos/shared';
import { Copy, Link2Off, Plug, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { ConfirmDialog } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import {
  useConnectChannel,
  useDisconnectChannel,
  useMessagingChannel,
  useSaveTemplate,
  useUpdateAutoSend,
} from '../messaging/api';

/**
 * O WhatsApp da oficina (E22).
 *
 * As credenciais são **dela**: cada oficina cria a própria conta na Meta e cola
 * aqui. Isso é mais trabalho do que um botão "conectar", e é o único desenho
 * honesto — o número que fala com o cliente é o número da oficina, o limite de
 * envio é o dela, e se ela sair do OficinaOS o WhatsApp continua sendo dela.
 *
 * Sem conectar nada, o sistema continua funcionando como sempre: as mensagens
 * saem pelo link do WhatsApp, com o texto pronto.
 */
export function WhatsAppSettingsPage() {
  const visao = useMessagingChannel();
  return visao.isPending ? (
    <Card className="space-y-4 p-6" aria-label="Carregando o canal de WhatsApp">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </Card>
  ) : visao.isError ? (
    <Alert variant="danger">{errorMessage(visao.error)}</Alert>
  ) : (
    <Conteudo dados={visao.data} />
  );
}

function Conteudo({ dados }: { dados: MessagingOverview }) {
  const { channel } = dados;
  const conectado = channel.status === 'CONNECTED';

  return (
    <div className="space-y-6">
      {!conectado && (
        <Alert variant="info">
          <span>
            <strong>Suas mensagens já funcionam sem isto.</strong> Hoje elas saem pelo link do WhatsApp: o sistema
            escreve o texto e você aperta enviar. Conectar a conta oficial serve para o sistema enviar sozinho e para as
            <strong> respostas do cliente chegarem aqui dentro</strong>.
          </span>
        </Alert>
      )}

      <Card>
        <CardHeader
          title="O WhatsApp da sua oficina"
          description="A conta é sua, na Meta. O token fica guardado cifrado e nunca aparece de volta nesta tela."
          action={
            <Badge tone={conectado ? 'success' : channel.status === 'ERROR' ? 'danger' : 'neutral'}>
              {CHANNEL_STATUS_LABELS[channel.status]}
            </Badge>
          }
        />
        {conectado ? <Conectado dados={dados} /> : <Conectar />}
      </Card>

      <Card>
        <CardHeader
          title="Onde a Meta avisa das respostas"
          description="Cole estes dois valores no painel da Meta, em WhatsApp → Configuração → Webhook."
        />
        <div className="space-y-3 px-5 pb-5">
          <CampoParaCopiar label="URL de callback" valor={channel.webhookUrl ?? ''} />
          <CampoParaCopiar label="Token de verificação" valor={channel.verifyToken ?? ''} />
          <p className="text-xs text-muted">
            A Meta só aceita endereço com HTTPS e certificado válido. Assine os eventos <code>messages</code> para
            receber as respostas e os avisos de entrega.
          </p>
        </div>
      </Card>

      <AutoEnvio dados={dados} />
      <Modelos dados={dados} />
    </div>
  );
}

function Conectar() {
  const conectar = useConnectChannel();
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');

  const enviar = async () => {
    try {
      await conectar.mutateAsync({
        phoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim() || undefined,
        accessToken: accessToken.trim(),
        appSecret: appSecret.trim(),
      });
      toast.success('WhatsApp conectado. Agora cole o webhook no painel da Meta.');
      setAccessToken('');
      setAppSecret('');
    } catch (erro) {
      toast.error(errorMessage(erro));
    }
  };

  return (
    <div className="space-y-4 px-5 pb-5">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>
          Crie um app no <strong>developers.facebook.com</strong> e adicione o produto WhatsApp.
        </li>
        <li>Cadastre o número da oficina e copie o identificador dele (Phone number ID).</li>
        <li>Gere um token de acesso permanente para um usuário do sistema com permissão de mensagens.</li>
        <li>Copie a chave secreta do app (App secret), em Configurações → Básico.</li>
      </ol>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone number ID" htmlFor="phone-number-id" hint="Só números, como aparece no painel.">
          <Input
            {...fieldA11y('phone-number-id')}
            value={phoneNumberId}
            onChange={(event) => setPhoneNumberId(event.target.value)}
          />
        </Field>
        <Field label="WhatsApp Business Account ID" htmlFor="waba-id" hint="Opcional, ajuda no suporte.">
          <Input {...fieldA11y('waba-id')} value={wabaId} onChange={(event) => setWabaId(event.target.value)} />
        </Field>
        <Field
          label="Token de acesso"
          htmlFor="access-token"
          hint="Guardado cifrado; depois de salvar, só mostramos o final."
        >
          <Input
            {...fieldA11y('access-token')}
            type="password"
            autoComplete="off"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
          />
        </Field>
        <Field label="App secret" htmlFor="app-secret" hint="É com ele que conferimos que o aviso veio da Meta.">
          <Input
            {...fieldA11y('app-secret')}
            type="password"
            autoComplete="off"
            value={appSecret}
            onChange={(event) => setAppSecret(event.target.value)}
          />
        </Field>
      </div>

      <Button
        loading={conectar.isPending}
        disabled={!phoneNumberId.trim() || accessToken.trim().length < 20 || appSecret.trim().length < 8}
        onClick={() => void enviar()}
      >
        <Plug />
        Conectar e testar
      </Button>
      <p className="text-xs text-muted">
        Antes de salvar, perguntamos à Meta qual é o número desse identificador. Se a credencial estiver errada, nada é
        guardado.
      </p>
    </div>
  );
}

function Conectado({ dados }: { dados: MessagingOverview }) {
  const { channel } = dados;
  const desconectar = useDisconnectChannel();
  const [confirmar, setConfirmar] = useState(false);

  return (
    <div className="space-y-4 px-5 pb-5">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">Número</dt>
          <dd className="font-medium">{channel.displayPhone ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Token</dt>
          <dd className="font-medium">{channel.tokenHint ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Conectado em</dt>
          <dd className="font-medium">{channel.connectedAt ? formatDateTime(channel.connectedAt) : '—'}</dd>
        </div>
      </dl>

      {channel.lastError && (
        <Alert variant="warning">
          <span>
            <strong>Último erro da Meta:</strong> {channel.lastError}
          </span>
        </Alert>
      )}

      <Button variant="secondary" onClick={() => setConfirmar(true)}>
        <Link2Off />
        Desconectar
      </Button>
      <ConfirmDialog
        open={confirmar}
        onOpenChange={setConfirmar}
        title="Desconectar o WhatsApp?"
        description="O token e a chave secreta são apagados daqui. As mensagens voltam a sair pelo link, e as respostas dos clientes deixam de chegar no sistema."
        confirmLabel="Desconectar"
        destructive
        onConfirm={async () => {
          try {
            await desconectar.mutateAsync();
            toast.success('WhatsApp desconectado.');
          } catch (erro) {
            toast.error(errorMessage(erro));
          }
        }}
      />
    </div>
  );
}

function CampoParaCopiar({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={label} htmlFor={`copiar-${label}`} className="min-w-0 flex-1">
        <Input {...fieldA11y(`copiar-${label}`)} readOnly value={valor} />
      </Field>
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(valor);
            toast.success(`${label} copiado.`);
          } catch {
            toast.error('Não deu para copiar. Selecione o texto e copie na mão.');
          }
        }}
      >
        <Copy />
        Copiar
      </Button>
    </div>
  );
}

/**
 * Envio automático. Só modelo de utilidade aparece aqui: pós-venda e
 * reengajamento sempre esperam alguém apertar o botão, e a API recusa de
 * qualquer jeito.
 */
function AutoEnvio({ dados }: { dados: MessagingOverview }) {
  const salvar = useUpdateAutoSend();
  // só o que tem gatilho ligado aparece: interruptor que não faz nada é mentira
  const podem = dados.templates.filter((modelo) => modelo.podeSerAutomatica && modelo.gatilho);
  const [pendente, setPendente] = useState<Partial<Record<MessageTemplateKey, boolean>>>({});

  const alternar = async (key: MessageTemplateKey, ligado: boolean) => {
    // o interruptor anda na hora e volta sozinho se falhar
    setPendente((atual) => ({ ...atual, [key]: ligado }));
    const autoSend = podem
      .filter((modelo) => (modelo.key === key ? ligado : (pendente[modelo.key] ?? modelo.automatica)))
      .map((modelo) => modelo.key);
    try {
      await salvar.mutateAsync({ autoSend });
      toast.success(ligado ? 'Passa a sair sozinha.' : 'Volta a esperar o botão.');
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
    <Card>
      <CardHeader
        title="Enviar sozinho"
        description="Só mensagem sobre o serviço que o cliente contratou pode sair sem alguém apertar enviar — e só as que têm um evento que as dispare."
      />
      <ul className="divide-y divide-border">
        {podem.map((modelo) => (
          <li key={modelo.key} className="px-5 py-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-accent"
                checked={pendente[modelo.key] ?? modelo.automatica}
                disabled={dados.channel.status !== 'CONNECTED'}
                onChange={(event) => void alternar(modelo.key, event.target.checked)}
              />
              <span>
                <span className="font-medium">{modelo.label}</span>
                <span className="block text-sm text-muted">
                  {modelo.descricao} Sai {modelo.gatilho}.
                </span>
                {modelo.status !== 'APPROVED' && (
                  <span className="mt-1 block text-xs text-warning">
                    Fora da janela de 24 h esta mensagem só sai depois de aprovada na Meta.
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 px-5 pb-5 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Pós-venda, convite para avaliar, revisão vencendo e cliente sem voltar <strong>nunca</strong> saem sozinhos:
        mensagem de reengajamento disparada em massa é o caminho mais curto para o número ser bloqueado pela Meta.
      </p>
    </Card>
  );
}

function Modelos({ dados }: { dados: MessagingOverview }) {
  return (
    <Card>
      <CardHeader
        title="Modelos para submeter à Meta"
        description="Fora da janela de 24 h, a Meta só entrega mensagem com modelo aprovado. Copie o texto abaixo no painel dela e marque aqui o que ela respondeu."
      />
      <ul className="divide-y divide-border">
        {dados.templates.map((modelo) => (
          <li key={modelo.key} className="px-5 py-4">
            <LinhaDoModelo modelo={modelo} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LinhaDoModelo({ modelo }: { modelo: MessageTemplateInfo }) {
  const salvar = useSaveTemplate();
  const [nome, setNome] = useState(modelo.providerName ?? '');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {modelo.label}
            <Badge tone={modelo.categoria === 'UTILITY' ? 'info' : 'neutral'}>
              {TEMPLATE_CATEGORY_LABELS[modelo.categoria]}
            </Badge>
            <Badge
              tone={
                modelo.status === 'APPROVED'
                  ? 'success'
                  : modelo.status === 'REJECTED'
                    ? 'danger'
                    : modelo.status === 'PENDING'
                      ? 'warning'
                      : 'neutral'
              }
            >
              {TEMPLATE_STATUS_LABELS[modelo.status]}
            </Badge>
          </p>
          <p className="text-sm text-muted">{modelo.descricao}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(modelo.exemplo);
              toast.success('Texto do modelo copiado.');
            } catch {
              toast.error('Não deu para copiar. Selecione o texto e copie na mão.');
            }
          }}
        >
          <Copy />
          Copiar texto
        </Button>
      </div>

      <pre className="overflow-x-auto rounded-lg border border-border bg-surface-muted p-3 text-xs whitespace-pre-wrap">
        {modelo.exemplo}
      </pre>
      <p className="text-xs text-muted">
        Variáveis, na ordem: {modelo.variaveis.map((nomeDaVariavel, i) => `{{${i + 1}}} = ${nomeDaVariavel}`).join(' · ')}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="O que a Meta respondeu" htmlFor={`status-${modelo.key}`}>
          <Select
            {...fieldA11y(`status-${modelo.key}`)}
            value={modelo.status}
            onChange={async (event) => {
              try {
                await salvar.mutateAsync({ key: modelo.key, status: event.target.value as TemplateStatus });
                toast.success('Situação salva.');
              } catch (erro) {
                toast.error(errorMessage(erro));
              }
            }}
          >
            {TEMPLATE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TEMPLATE_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Nome do modelo na Meta"
          htmlFor={`nome-${modelo.key}`}
          hint={`Vazio = ${modelo.key.toLowerCase()}`}
        >
          <Input
            {...fieldA11y(`nome-${modelo.key}`, undefined, true)}
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            onBlur={async () => {
              const valor = nome.trim();
              if (valor === (modelo.providerName ?? '')) return;
              try {
                await salvar.mutateAsync({ key: modelo.key, providerName: valor === '' ? null : valor });
                toast.success('Nome salvo.');
              } catch (erro) {
                toast.error(errorMessage(erro));
              }
            }}
          />
        </Field>
      </div>
    </div>
  );
}
