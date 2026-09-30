import {
  PLAN_FEATURE_LABELS,
  planoMaisBaratoCom,
  type PlanCode,
  type PlanFeature,
} from '@oficinaos/shared';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from './ui/button';
import { Card } from './ui/display';
import { useFeature, useSession } from '../lib/session';

/** O que cada plano resolve, em uma linha, para o convite não ser só um preço. */
const O_QUE_O_PLANO_ABRE: Record<PlanCode, string> = {
  TURBO: 'Abre a oficina inteira: OS, orçamento por link, Pix, estoque e financeiro.',
  SUPERCHARGER: 'Abre o que faz você entender a oficina: comissão, relatórios e pacotes de serviço.',
  NITRO: 'Abre o sistema trabalhando sozinho: WhatsApp oficial, automações e a pesquisa de peças por carro.',
};

const NOME_DO_PLANO: Record<PlanCode, string> = {
  TURBO: 'Turbo',
  SUPERCHARGER: 'Supercharger',
  NITRO: 'Nitro',
};

/**
 * O convite para assinar, quando a oficina esbarra numa funcionalidade que o
 * plano dela não tem (E40).
 *
 * Não é um "acesso negado". A pessoa não fez nada errado e não adianta pedir
 * para ela falar com o dono — ela normalmente É o dono. Então a tela diz o que
 * a funcionalidade faz, em qual plano ela mora, e leva para a tela de
 * assinatura num clique. Beco sem saída é o que faz a pessoa fechar o sistema.
 */
export function UpgradePanel({ feature, className }: { feature: PlanFeature; className?: string }) {
  const necessario = planoMaisBaratoCom(feature) as PlanCode | null;
  const { state } = useSession();
  const atual = state.status === 'authenticated' ? state.me.subscription?.planName : null;

  return (
    <Card className={className}>
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-accent-subtle text-accent">
          <Lock className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-3 text-lg font-medium">{PLAN_FEATURE_LABELS[feature]}</p>
        <p className="mt-1 max-w-md text-sm text-muted">
          {necessario ? (
            <>
              Está disponível a partir do plano <strong className="text-foreground">{NOME_DO_PLANO[necessario]}</strong>
              {atual ? <> — o seu hoje é o {atual}.</> : '.'}
              <br />
              {O_QUE_O_PLANO_ABRE[necessario]}
            </>
          ) : (
            'Esta funcionalidade não está no seu plano.'
          )}
        </p>
        <Button asChild className="mt-5">
          <Link to="/configuracoes/plano">Ver planos</Link>
        </Button>
        <p className="mt-3 text-xs text-muted">
          Você continua com tudo o que já cadastrou. Trocar de plano vale na hora.
        </p>
      </div>
    </Card>
  );
}

/**
 * Envolve uma tela inteira: mostra o conteúdo quando o plano inclui, e o
 * convite quando não inclui.
 *
 * O menu já esconde o item, então quem chega aqui digitou o endereço ou seguiu
 * um link antigo — e mesmo assim precisa de uma saída, não de um 404.
 * Quem garante de verdade é a API, que devolve 402 na rota.
 */
export function PlanGate({ feature, children }: { feature: PlanFeature; children: ReactNode }) {
  const temNoPlano = useFeature(feature);
  if (!temNoPlano) return <UpgradePanel feature={feature} />;
  return <>{children}</>;
}
