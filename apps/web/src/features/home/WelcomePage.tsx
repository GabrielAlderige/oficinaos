import { TRIAL_DAYS } from '@oficinaos/shared';
import { ArrowRight, Database, MessageCircle, Wrench } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/display';
import { errorMessage } from '../../lib/errors';
import { firstName } from '../../lib/format';
import { linkDaImplantacao } from '../../lib/implantacao';
import { useMe } from '../../lib/session';
import { useLoadSampleData } from './api';

/**
 * A tela logo depois do cadastro (D92): os dois caminhos da oferta Oficina
 * Pronta.
 *
 * O caminho principal é pedir a implantação grátis — a oficina que entra com
 * os próprios clientes e serviços já cadastrados é a que não desiste na tela
 * vazia. Quem prefere fazer sozinho vai para o Início, com a lista de
 * primeiros passos, e pode encher o sistema com dados de exemplo antes.
 */
export function WelcomePage() {
  const me = useMe();
  const navigate = useNavigate();
  const exemplo = useLoadSampleData();

  return (
    <div className="mx-auto max-w-3xl py-2">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          Bem-vindo, {firstName(me.user.name)}! A {me.organization.name} já está no OficinaOS.
        </h1>
        <p className="mt-2 text-muted">
          Seus {TRIAL_DAYS} dias grátis no plano completo só começam a contar no primeiro orçamento que você enviar.
          Como você quer começar?
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-4 border-accent p-5">
          <span className="grid size-10 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
            <Wrench className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-semibold">Quero que configurem para mim, de graça</h2>
            <p className="mt-1.5 text-sm text-muted">
              Em até 1 hora, na sua oficina ou por chamada de vídeo. A gente cadastra os clientes e carros de agora, os
              serviços e as peças que mais saem, coloca o aplicativo no seu celular e faz a primeira OS junto com você.
            </p>
          </div>
          <Button asChild size="lg">
            <a href={linkDaImplantacao(me.organization.name)} target="_blank" rel="noreferrer">
              <MessageCircle />
              Marcar pelo WhatsApp
            </a>
          </Button>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <span className="grid size-10 place-items-center rounded-lg bg-surface-muted text-muted" aria-hidden="true">
            <ArrowRight className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-semibold">Vou configurar sozinho</h2>
            <p className="mt-1.5 text-sm text-muted">
              No Início tem uma lista de 4 passos: dados da oficina, um cliente, um serviço e o primeiro orçamento. Quer
              ver o sistema cheio antes? Carregue clientes, carros e serviços de exemplo e apague quando quiser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="lg">
              <Link to="/">Começar</Link>
            </Button>
            <Button
              variant="secondary"
              size="lg"
              loading={exemplo.isPending}
              onClick={async () => {
                try {
                  await exemplo.mutateAsync();
                  toast.success('Dados de exemplo carregados. Dá para apagar no Início.');
                  navigate('/', { replace: true });
                } catch (erro) {
                  toast.error(errorMessage(erro));
                }
              }}
            >
              <Database />
              Com dados de exemplo
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
