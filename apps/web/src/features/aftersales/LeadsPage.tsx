import {
  formatBRL,
  formatBRLInput,
  parseBRL,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_TONES,
  LEAD_STAGES,
  type Lead,
  type LeadSource,
  type LeadStage,
} from '@oficinaos/shared';
import { ArrowRight, MessageCircle, Plus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { AdornedInput, Input, Textarea } from '../../components/ui/input';
import { EmptyState, SearchInput } from '../../components/ui/list-parts';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { useConvertLead, useCreateLead, useMoveLead, usePipeline } from './api';

/** As colunas do quadro. "Perdido" fica fora: ele mora na lista de baixo. */
const NO_QUADRO: LeadStage[] = LEAD_STAGES.filter((stage) => stage !== 'LOST');

/**
 * O funil (E16). Um quadro com as etapas em colunas: o que está vivo, quanto
 * vale e há quanto tempo ninguém toca naquele contato — que é o número que faz
 * o dono pegar o telefone.
 *
 * Mover é por botão, não por arrastar: a maior parte do uso é no celular do
 * balcão, e arrastar card em tela pequena é pior que tocar em "avançar".
 */
export function LeadsPage() {
  const podeMexer = useCan('customers:write');
  const [busca, setBusca] = useState('');
  const q = useDebouncedValue(busca.trim(), 300);
  const funil = usePipeline(q);
  const [criando, setCriando] = useState(false);
  const dados = funil.data;
  const perdidos = dados?.stages.find((etapa) => etapa.stage === 'LOST');

  return (
    <>
      <PageHeader
        title="Funil"
        description="O orçamento que ainda não virou OS e a ligação que não pode esfriar."
        actions={
          podeMexer && (
            <Button onClick={() => setCriando(true)}>
              <Plus />
              Novo contato
            </Button>
          )
        }
      />

      {dados && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Tile rotulo="Em aberto no funil" valor={formatBRL(dados.openValueCents)} />
          <Tile
            rotulo="Conversão"
            valor={`${(dados.conversionBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
            detalhe="dos contatos já decididos"
          />
          <Tile rotulo="Perdidos" valor={String(perdidos?.count ?? 0)} detalhe={perdidos?.count ? 'veja o motivo no card' : undefined} />
        </div>
      )}

      <div className="mb-4">
        <SearchInput value={busca} onChange={setBusca} placeholder="Nome, telefone ou carro" label="Buscar no funil" />
      </div>

      {funil.isPending ? (
        <div className="grid gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : funil.isError ? (
        <Alert variant="danger">{errorMessage(funil.error)}</Alert>
      ) : !dados?.stages.some((etapa) => etapa.count > 0) ? (
        <Card>
          <EmptyState
            icon={Users}
            title="Nenhum contato no funil"
            description="Anote aqui quem ligou pedindo preço, quem passou na porta e quem recebeu orçamento e sumiu."
            action={podeMexer && <Button onClick={() => setCriando(true)}>Novo contato</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-5">
            {NO_QUADRO.map((stage) => {
              const etapa = dados.stages.find((linha) => linha.stage === stage)!;
              return (
                <section key={stage} className="min-w-0">
                  <header className="mb-2 flex items-baseline justify-between gap-2">
                    <h2 className="text-sm font-medium">{LEAD_STAGE_LABELS[stage]}</h2>
                    <span className="text-xs text-muted tabular">
                      {etapa.count}
                      {etapa.valueCents > 0 && ` · ${formatBRL(etapa.valueCents)}`}
                    </span>
                  </header>
                  <ul className="space-y-2">
                    {etapa.leads.map((lead) => (
                      <li key={lead.id}>
                        <LeadCard lead={lead} podeMexer={podeMexer} />
                      </li>
                    ))}
                    {!etapa.leads.length && (
                      <li className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
                        vazio
                      </li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>

          {perdidos && perdidos.leads.length > 0 && (
            <Card className="mt-6">
              <CardHeader title="Perdidos" description="Com o motivo — é o que o funil tem a ensinar." />
              <ul className="divide-y divide-border">
                {perdidos.leads.map((lead) => (
                  <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                    <span>
                      <span className="font-medium">{lead.name}</span>
                      {lead.vehicleDesc && <span className="text-muted"> · {lead.vehicleDesc}</span>}
                    </span>
                    <span className="text-muted">{lead.lostReason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <NovoLeadDialog open={criando} onOpenChange={setCriando} />
    </>
  );
}

function Tile({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-sm text-muted">{rotulo}</p>
      <p className="mt-1 text-xl font-semibold">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-muted">{detalhe}</p>}
    </div>
  );
}

function LeadCard({ lead, podeMexer }: { lead: Lead; podeMexer: boolean }) {
  const mover = useMoveLead(lead.id);
  const converter = useConvertLead(lead.id);
  const [perdendo, setPerdendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const proxima = NO_QUADRO[NO_QUADRO.indexOf(lead.stage) + 1];

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      {/* o nome quebra em vez de cortar: "Sim..." não ajuda ninguém a ligar */}
      <p className="text-sm leading-tight font-medium break-words">{lead.name}</p>
      {lead.vehicleDesc && <p className="mt-0.5 truncate text-xs text-muted">{lead.vehicleDesc}</p>}
      {lead.need && <p className="mt-1 line-clamp-2 text-xs text-muted">{lead.need}</p>}
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={LEAD_STAGE_TONES[lead.stage]}>{LEAD_SOURCE_LABELS[lead.source]}</Badge>
        {lead.estimatedValueCents > 0 && <span className="font-medium tabular">{formatBRL(lead.estimatedValueCents)}</span>}
        {lead.stage !== 'WON' && lead.idleDays >= 3 && (
          <span className={cn(lead.idleDays >= 7 ? 'text-danger' : 'text-muted')}>parado há {lead.idleDays}d</span>
        )}
        {lead.customerId && (
          <Link className="text-muted underline" to={`/clientes/${lead.customerId}`}>
            ver cliente
          </Link>
        )}
      </p>

      {podeMexer && (
        <div className="mt-2 flex flex-wrap gap-1">
          {lead.whatsappUrl && (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <a href={lead.whatsappUrl} target="_blank" rel="noreferrer noopener" aria-label={`Abrir conversa com ${lead.name}`}>
                <MessageCircle />
              </a>
            </Button>
          )}
          {proxima && lead.stage !== 'WON' && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              loading={mover.isPending}
              onClick={async () => {
                try {
                  await mover.mutateAsync({ stage: proxima, lostReason: '' });
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              <ArrowRight />
              {LEAD_STAGE_LABELS[proxima]}
            </Button>
          )}
          {lead.stage === 'WON' && !lead.customerId && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              loading={converter.isPending}
              onClick={async () => {
                try {
                  await converter.mutateAsync(null);
                  toast.success('Cliente criado a partir do contato.');
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              <UserPlus />
              Virar cliente
            </Button>
          )}
          {lead.stage !== 'WON' && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPerdendo(true)}>
              Perdi
            </Button>
          )}
        </div>
      )}

      <Dialog open={perdendo} onOpenChange={setPerdendo}>
        <DialogContent>
          <DialogHeader
            title="Por que este contato foi perdido?"
            description="Funil sem motivo de perda não ensina nada — e é o motivo que mostra o que arrumar."
          />
          <Field label="Motivo" htmlFor={`perda-${lead.id}`}>
            <Input
              {...fieldA11y(`perda-${lead.id}`)}
              autoFocus
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              placeholder="Ex.: achou caro, foi na concorrência"
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPerdendo(false)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              disabled={motivo.trim().length < 3}
              loading={mover.isPending}
              onClick={async () => {
                try {
                  await mover.mutateAsync({ stage: 'LOST', lostReason: motivo.trim() });
                  setPerdendo(false);
                  setMotivo('');
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              Marcar como perdido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NovoLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const criar = useCreateLead();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [origem, setOrigem] = useState<LeadSource>('WHATSAPP');
  const [carro, setCarro] = useState('');
  const [precisa, setPrecisa] = useState('');
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function fechar() {
    setNome('');
    setTelefone('');
    setCarro('');
    setPrecisa('');
    setValor('');
    setErro(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(proximo) => (proximo ? onOpenChange(true) : fechar())}>
      <DialogContent>
        <DialogHeader title="Novo contato" description="Quem ligou, quem passou na porta, quem pediu preço." />
        <div className="space-y-4">
          {erro && <Alert variant="danger">{erro}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="lead-nome">
              <Input {...fieldA11y('lead-nome')} autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
            </Field>
            <Field label="WhatsApp" htmlFor="lead-telefone">
              <Input
                {...fieldA11y('lead-telefone')}
                inputMode="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(11) 90000-0000"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Como chegou" htmlFor="lead-origem">
              <Select id="lead-origem" value={origem} onChange={(e) => setOrigem(e.target.value as LeadSource)}>
                {LEAD_SOURCES.map((opcao) => (
                  <option key={opcao} value={opcao}>
                    {LEAD_SOURCE_LABELS[opcao]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Valor estimado" htmlFor="lead-valor" hint="Opcional. É o que soma no funil.">
              <AdornedInput
                {...fieldA11y('lead-valor', undefined, true)}
                leading="R$"
                inputMode="numeric"
                value={valor}
                onChange={(e) => setValor(formatBRLInput(parseBRL(e.target.value) ?? 0))}
              />
            </Field>
          </div>
          <Field label="Carro" htmlFor="lead-carro">
            <Input
              {...fieldA11y('lead-carro')}
              value={carro}
              onChange={(e) => setCarro(e.target.value)}
              placeholder="Ex.: Gol 2014, placa ABC1D23"
            />
          </Field>
          <Field label="O que precisa" htmlFor="lead-precisa">
            <Textarea
              id="lead-precisa"
              rows={2}
              value={precisa}
              onChange={(e) => setPrecisa(e.target.value)}
              placeholder="Ex.: barulho na suspensão, quer orçamento"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            loading={criar.isPending}
            onClick={async () => {
              setErro(null);
              if (nome.trim().length < 2) return setErro('Informe o nome.');
              try {
                await criar.mutateAsync({
                  name: nome.trim(),
                  phone: telefone,
                  source: origem,
                  vehicleDesc: carro,
                  need: precisa,
                  estimatedValueCents: parseBRL(valor || '0') ?? 0,
                  notes: '',
                });
                toast.success('Contato no funil.');
                fechar();
              } catch (err) {
                setErro(errorMessage(err));
              }
            }}
          >
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
