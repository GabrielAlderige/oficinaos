import { PROSPECT_SOURCE_LABELS, type Prospect } from '@oficinaos/shared';
import { Check, Download, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton } from '../../components/ui/display';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useDownloadProspects, useMarkProspect, useProspects } from './api';

/** (35) 99841-6972 — é assim que se lê antes de ligar. */
function telefoneLegivel(digitos: string): string {
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return digitos;
}

/**
 * Os interessados que vieram do site (E42) — área da PLATAFORMA.
 *
 * É a fila do comercial: quem entrou, quem já foi chamado, e o botão que baixa
 * a planilha do remarketing. Não é o funil de clientes da oficina (E16), que é
 * outra coisa e mora dentro de cada oficina.
 */
export function ProspectsPage() {
  const visao = useProspects();

  return (
    <>
      <PageHeader
        title="Interessados"
        description="Quem preencheu o formulário do site. A planilha sai daqui para o remarketing."
        actions={
          <BotaoPlanilha />
        }
      />

      {visao.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : visao.isError ? (
        <Alert variant="danger">{errorMessage(visao.error)}</Alert>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Resumo titulo="Total" valor={visao.data.total} />
            <Resumo titulo="Aguardando contato" valor={visao.data.aguardando} destaque={visao.data.aguardando > 0} />
            <Resumo titulo="Entraram na semana" valor={visao.data.daSemana} />
          </div>

          <Card>
            <CardHeader title="Fila" description="Mais recentes primeiro. Quem já foi chamado fica esmaecido." />
            {visao.data.prospects.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">
                Ninguém preencheu o formulário ainda. Assim que o site estiver no ar, os contatos caem aqui.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {visao.data.prospects.map((pessoa) => (
                  <li key={pessoa.id}>
                    <Linha pessoa={pessoa} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

/**
 * Baixa o CSV. Precisa de `fetch` com o token — `window.open` abriria uma aba
 * com 401, porque não manda cabeçalho de autorização.
 */
function BotaoPlanilha() {
  const baixar = useDownloadProspects();
  return (
    <Button
      variant="secondary"
      loading={baixar.isPending}
      onClick={async () => {
        try {
          const nome = await baixar.mutateAsync();
          toast.success(`Planilha ${nome} baixada.`);
        } catch (erro) {
          toast.error(errorMessage(erro));
        }
      }}
    >
      <Download />
      Baixar planilha
    </Button>
  );
}

function Resumo({ titulo, valor, destaque }: { titulo: string; valor: number; destaque?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs tracking-wide text-muted uppercase">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${destaque ? 'text-accent' : ''}`}>{valor}</p>
    </Card>
  );
}

function Linha({ pessoa }: { pessoa: Prospect }) {
  const marcar = useMarkProspect();
  const jaChamado = pessoa.contactedAt !== null;
  const texto = `Oi ${pessoa.name.split(' ')[0]}, aqui é o Gabriel do OficinaOS. Você deixou contato no site — posso te mostrar funcionando em 15 minutos?`;

  return (
    <div className={`flex flex-wrap items-center gap-3 px-5 py-3 ${jaChamado ? 'opacity-55' : ''}`}>
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{pessoa.name}</span>
          <Badge tone="neutral">{PROSPECT_SOURCE_LABELS[pessoa.source]}</Badge>
          {jaChamado && <Badge tone="success">Contatado</Badge>}
        </span>
        <span className="block truncate text-xs text-muted">
          {telefoneLegivel(pessoa.phone)}
          {pessoa.workshopName ? ` · ${pessoa.workshopName}` : ''}
          {pessoa.email ? ` · ${pessoa.email}` : ''}
          {` · ${formatDateTime(pessoa.createdAt)}`}
        </span>
        {pessoa.message && <p className="mt-1 text-sm text-muted italic">“{pessoa.message}”</p>}
        {pessoa.notes && <p className="mt-1 text-xs text-muted">Anotação: {pessoa.notes}</p>}
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label={`Falar com ${pessoa.name} no WhatsApp`}
        onClick={() => {
          window.open(`https://wa.me/55${pessoa.phone}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
        }}
      >
        <MessageCircle />
      </Button>
      <Button
        variant={jaChamado ? 'ghost' : 'secondary'}
        size="sm"
        loading={marcar.isPending}
        onClick={async () => {
          try {
            await marcar.mutateAsync({ id: pessoa.id, contacted: !jaChamado });
            toast.success(jaChamado ? 'Voltou para a fila.' : 'Marcado como contatado.');
          } catch (erro) {
            toast.error(errorMessage(erro));
          }
        }}
      >
        <Check />
        {jaChamado ? 'Desmarcar' : 'Contatado'}
      </Button>
    </div>
  );
}
