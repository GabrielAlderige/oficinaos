import { posDeviceSchema, type PosDevice } from '@oficinaos/shared';
import { CreditCard, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input, PasswordInput } from '../../components/ui/input';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { usePosSettings, useUpdatePosSettings } from './api';

/**
 * Configurações → Maquininha (E50). A oficina cola a chave da conta Stone
 * dela e cadastra as maquininhas pelo número de série. A chave vai cifrada
 * para o servidor e nunca mais volta para a tela.
 */
export function PosSettingsPage() {
  const config = usePosSettings();
  if (config.isPending) return <Skeleton className="h-64 w-full" />;
  if (config.isError) return <Alert variant="danger">{errorMessage(config.error)}</Alert>;
  return <Formulario key={config.data.updatedAt ?? 'novo'} dispositivos={config.data.devices} />;
}

function Formulario({ dispositivos }: { dispositivos: PosDevice[] }) {
  const pode = useCan('organization:manage');
  const config = usePosSettings();
  const salvar = useUpdatePosSettings();
  const [chave, setChave] = useState('');
  const [lista, setLista] = useState<PosDevice[]>(dispositivos);
  const [novoSerial, setNovoSerial] = useState('');
  const [novoNome, setNovoNome] = useState('Balcão');
  const dados = config.data!;
  const ligada = dados.provider === 'stone';

  function adicionar() {
    const r = posDeviceSchema.safeParse({ serial: novoSerial, name: novoNome });
    if (!r.success) return toast.error(r.error.issues[0]?.message ?? 'Confira o número de série.');
    if (lista.some((d) => d.serial === r.data.serial)) return toast.error('Esta maquininha já está na lista.');
    setLista((atual) => [...atual, r.data]);
    setNovoSerial('');
  }

  async function gravar(corpo: Parameters<typeof salvar.mutateAsync>[0], mensagem: string) {
    try {
      await salvar.mutateAsync(corpo);
      toast.success(mensagem);
      setChave('');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      {!dados.partnerReady && (
        <Alert variant="warning">
          <span className="flex items-start gap-2">
            <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>Maquininha em modo simulação.</strong> A integração com a Stone está pronta e aguarda a
              homologação do OficinaOS como parceiro Stone. Até lá dá para cadastrar tudo e testar o fluxo inteiro —
              nenhuma cobrança vai para a maquininha de verdade.
            </span>
          </span>
        </Alert>
      )}

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Conta Stone
              <Badge tone={ligada ? 'success' : 'neutral'}>{ligada ? `Chave ligada (…${dados.keyHint ?? ''})` : 'Sem chave'}</Badge>
            </span>
          }
          description="O dinheiro cai direto na conta Stone da oficina. O OficinaOS só manda o valor para a maquininha e recebe a confirmação."
        />
        <div className="space-y-4 px-5 pb-5 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>Entre no painel Pagar.me da sua conta Stone (id.pagar.me).</li>
            <li>
              Vá em <strong>Desenvolvimento → Chaves</strong> e copie a <strong>chave secreta</strong> (começa com sk_).
            </li>
            <li>Cole aqui embaixo. Ela é guardada cifrada e não aparece mais na tela.</li>
          </ol>
          {pode && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label={ligada ? 'Trocar a chave' : 'Chave secreta (sk_…)'} htmlFor="pos-chave" className="min-w-64 flex-1">
                <PasswordInput {...fieldA11y('pos-chave')} value={chave} onChange={(e) => setChave(e.target.value)} autoComplete="off" />
              </Field>
              <Button disabled={!chave.trim() || salvar.isPending} onClick={() => void gravar({ secretKey: chave.trim() }, 'Chave da Stone salva.')}>
                Salvar chave
              </Button>
              {ligada && (
                <Button variant="ghost" disabled={salvar.isPending} onClick={() => void gravar({ disconnect: true }, 'Chave removida: a maquininha voltou ao simulador.')}>
                  Desligar
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Maquininhas" description="O número de série fica na etiqueta atrás da maquininha (S/N). A maquininha precisa estar com o app de pagamentos da Stone atualizado." />
        <div className="space-y-3 px-5 pb-5 text-sm">
          {lista.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {lista.map((d) => (
                <li key={d.serial} className="flex items-center gap-3 px-3 py-2">
                  <CreditCard className="size-4 text-muted" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="font-medium">{d.name}</span> <span className="text-muted">· {d.serial}</span>
                  </span>
                  {pode && (
                    <Button size="icon" variant="ghost" aria-label={`Remover ${d.name}`} onClick={() => setLista((atual) => atual.filter((x) => x.serial !== d.serial))}>
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Nenhuma maquininha cadastrada.</p>
          )}
          {pode && (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Número de série" htmlFor="pos-serial-novo" className="w-44">
                  <Input {...fieldA11y('pos-serial-novo')} value={novoSerial} onChange={(e) => setNovoSerial(e.target.value)} placeholder="6C568971" />
                </Field>
                <Field label="Nome" htmlFor="pos-nome-novo" className="w-40">
                  <Input {...fieldA11y('pos-nome-novo')} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
                </Field>
                <Button variant="secondary" onClick={adicionar}>
                  <Plus />
                  Adicionar
                </Button>
              </div>
              <Button disabled={salvar.isPending} onClick={() => void gravar({ devices: lista }, 'Maquininhas salvas.')}>
                Salvar maquininhas
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
