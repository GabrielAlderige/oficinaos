import {
  addDays,
  addMonths,
  dayKey,
  diaCurto,
  modoDoPeriodo,
  periodoDoModo,
  periodRange,
  rotuloDoPeriodo,
  type DashboardPeriod,
  type ModoDoPeriodo,
} from '@oficinaos/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { cn } from '../lib/cn';
import { useMe } from '../lib/session';
import { Input } from './ui/input';

/**
 * Escolha de período, igual em toda tela que tem período.
 *
 * O período ATUAL (hoje, esta semana, este mês, últimos 7/30) vai para o
 * servidor como NOME, não como data: "hoje" numa oficina de Manaus começa uma
 * hora depois do que numa de São Paulo, e quem sabe o fuso da oficina é a API.
 * Quando a pessoa anda para trás ("semana passada", "agosto"), aí vai data —
 * quem escolheu o dia foi ela, e não há o que interpretar.
 */
export interface Periodo {
  period: DashboardPeriod;
  from?: string;
  to?: string;
}

/**
 * O que o seletor emite: só o que MUDOU.
 *
 * Mandar o período inteiro parece mais simples e tem um defeito sério: quem
 * digita a data inicial e a final em seguida dispara as duas trocas antes do
 * primeiro render voltar, e a segunda reenviaria a data inicial velha por
 * cima da nova. Campo ausente quer dizer "não mexi"; `null` quer dizer "apague".
 */
export type PeriodoPatch = { period: DashboardPeriod; from?: string | null; to?: string | null };

/** Junta o que mudou ao que já existia. Os dois consumidores usam esta mesma regra. */
export function aplicarPeriodo(anterior: Periodo, patch: PeriodoPatch): Periodo {
  const campo = (chave: 'from' | 'to'): string | undefined =>
    chave in patch ? (patch[chave] ?? undefined) : anterior[chave];
  return { period: patch.period, from: campo('from'), to: campo('to') };
}

/**
 * O período guardado na URL (`periodo`, `de`, `ate`), igual em toda tela que o
 * usa: o link que a oficina manda para o contador abre o mesmo recorte.
 *
 * Quem digita a data inicial e a final em seguida escreve duas vezes antes do
 * primeiro render chegar, e a segunda gravação partiria da URL velha e apagaria
 * a primeira. A forma de função do `setSearchParams` NÃO resolve: o React
 * Router entrega a ela os params do último render, não os da escrita anterior.
 * Por isso a última escrita fica guardada até a URL alcançá-la.
 *
 * Com `padrao = null`, a ausência de `periodo` quer dizer "sem recorte" (a
 * lista de OS mostra tudo), e `limpar()` volta para lá.
 */
export function usePeriodoNaUrl(padrao: DashboardPeriod = 'month') {
  return usePeriodoOpcionalNaUrl(padrao) as unknown as readonly [Periodo, (patch: PeriodoPatch) => void, () => void];
}

export function usePeriodoOpcionalNaUrl(padrao: DashboardPeriod | null) {
  const [params, setParams] = useSearchParams();
  const escritaPendente = useRef<URLSearchParams | null>(null);
  const chave = params.toString();
  // a URL mudou: ela volta a ser a verdade (inclusive se outra coisa a mudou)
  useEffect(() => {
    escritaPendente.current = null;
  }, [chave]);

  const ler = (origem: URLSearchParams): Periodo | null => {
    const period = (origem.get('periodo') as DashboardPeriod | null) ?? padrao;
    if (!period) return null;
    return { period, from: origem.get('de') ?? undefined, to: origem.get('ate') ?? undefined };
  };
  const gravar = (proximo: URLSearchParams) => {
    // período novo é lista nova: volta para a primeira página
    proximo.delete('page');
    escritaPendente.current = proximo;
    setParams(proximo, { replace: true });
  };
  const trocar = (patch: PeriodoPatch) => {
    const anterior = escritaPendente.current ?? params;
    const novo = aplicarPeriodo(ler(anterior) ?? { period: patch.period }, patch);
    const proximo = new URLSearchParams(anterior);
    proximo.set('periodo', novo.period);
    if (novo.from) proximo.set('de', novo.from);
    else proximo.delete('de');
    if (novo.to) proximo.set('ate', novo.to);
    else proximo.delete('ate');
    gravar(proximo);
  };
  const limpar = () => {
    const proximo = new URLSearchParams(escritaPendente.current ?? params);
    for (const nome of ['periodo', 'de', 'ate']) proximo.delete(nome);
    gravar(proximo);
  };
  return [ler(params), trocar, limpar] as const;
}

// ------------------------------------------------------------------ o seletor

type Modo = ModoDoPeriodo;

const MODOS: { valor: Modo; rotulo: string }[] = [
  { valor: 'dia', rotulo: 'Dia' },
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'mes', rotulo: 'Mês' },
  { valor: 'periodo', rotulo: 'Período' },
];

const botaoBase =
  'inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface text-sm transition-colors hover:bg-surface-muted disabled:opacity-40';

export function PeriodPicker({
  valor,
  onChange,
  idPrefix,
  className,
  onLimpar,
  rotuloLimpar = 'Tudo',
}: {
  /** `null` = sem recorte (só com `onLimpar`) */
  valor: Periodo | null;
  onChange(patch: PeriodoPatch): void;
  /** prefixo dos ids, porque a tela pode ter mais de um seletor */
  idPrefix: string;
  className?: string;
  /** quando existe, aparece o botão "Tudo", que tira o recorte */
  onLimpar?(): void;
  rotuloLimpar?: string;
}) {
  /**
   * O dia de hoje NO RELÓGIO DA OFICINA. `toISOString()` dá o dia em UTC: em
   * São Paulo, depois das 21h, já é amanhã.
   */
  const { organization } = useMe();
  const hoje = dayKey(new Date(), organization.timezone);
  const janela = valor ? periodRange(valor.period, organization.timezone, { from: valor.from, to: valor.to }) : null;

  /**
   * O modo é escolha da PESSOA, guardada aqui. Deduzir das datas atrapalha:
   * quem digita 01/09 a 30/09 em "Período" veria a tela virar "Mês" no meio da
   * digitação. O modo só é deduzido quando o período chega de fora (o link).
   */
  const [modoEscolhido, setModoEscolhido] = useState<Modo | null>(null);
  const modoDeduzido = valor ? modoDoPeriodo(valor, hoje) : null;
  const modo: Modo | null = !valor ? null : (modoEscolhido ?? modoDeduzido);
  // o período foi trocado por fora (voltar do navegador, link): o deduzido volta a valer
  const assinatura = valor ? `${valor.period}|${valor.from ?? ''}|${valor.to ?? ''}` : '';
  const ultimaEmissao = useRef<string | null>(null);
  useEffect(() => {
    if (ultimaEmissao.current !== null && ultimaEmissao.current !== assinatura) setModoEscolhido(null);
    ultimaEmissao.current = null;
  }, [assinatura]);

  const emitir = (patch: PeriodoPatch, proximoModo: Modo) => {
    setModoEscolhido(proximoModo);
    const novo = aplicarPeriodo(valor ?? { period: patch.period }, patch);
    ultimaEmissao.current = `${novo.period}|${novo.from ?? ''}|${novo.to ?? ''}`;
    onChange(patch);
  };

  /** O dia de onde o modo novo parte: hoje, se ele estiver no período; senão, o início do período. */
  const ancora = janela && !(janela.fromDay <= hoje && hoje <= janela.toDay) ? janela.fromDay : hoje;

  const trocarModo = (novo: Modo) => {
    if (novo === modo) return;
    if (novo === 'periodo') {
      return emitir(
        { period: 'custom', from: janela?.fromDay ?? addDays(hoje, -6), to: janela?.toDay ?? hoje },
        'periodo',
      );
    }
    emitir(periodoDoModo(novo, ancora, hoje), novo);
  };

  const andar = (passo: -1 | 1) => {
    if (!janela || !modo || modo === 'periodo') return;
    const proximo =
      modo === 'dia'
        ? addDays(janela.fromDay, passo)
        : modo === 'semana'
          ? addDays(janela.fromDay, 7 * passo)
          : addMonths(janela.fromDay, passo);
    emitir(periodoDoModo(modo, proximo, hoje), modo);
  };

  const noAtual =
    !!janela &&
    !!modo &&
    modo !== 'periodo' &&
    janela.fromDay <= hoje &&
    hoje <= janela.toDay;
  const nomeDoAtual = modo === 'dia' ? 'Hoje' : modo === 'semana' ? 'Esta semana' : 'Este mês';

  const segmento = (ativo: boolean) =>
    cn(
      // no celular os botões dividem a largura (a 320px, cinco cabem só assim)
      'flex-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[13px] transition-colors sm:flex-none sm:px-3 sm:text-sm',
      ativo ? 'bg-accent-soft font-medium text-foreground' : 'text-muted hover:text-foreground',
    );

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-full rounded-lg border border-border bg-surface p-0.5 sm:w-auto" role="group" aria-label="Período">
          {onLimpar && (
            <button type="button" aria-pressed={!valor} onClick={() => valor && onLimpar()} className={segmento(!valor)}>
              {rotuloLimpar}
            </button>
          )}
          {MODOS.map((opcao) => (
            <button
              key={opcao.valor}
              type="button"
              aria-pressed={modo === opcao.valor}
              onClick={() => trocarModo(opcao.valor)}
              className={segmento(modo === opcao.valor)}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>

        {janela && modo && modo !== 'periodo' && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={cn(botaoBase, 'w-9')}
              onClick={() => andar(-1)}
              aria-label={modo === 'dia' ? 'Dia anterior' : modo === 'semana' ? 'Semana anterior' : 'Mês anterior'}
              title="Anterior"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <label className="sr-only" htmlFor={`${idPrefix}-ir`}>
              {modo === 'mes' ? 'Ir para o mês' : modo === 'semana' ? 'Ir para a semana do dia' : 'Ir para o dia'}
            </label>
            <Input
              id={`${idPrefix}-ir`}
              type={modo === 'mes' ? 'month' : 'date'}
              className={modo === 'mes' ? 'w-40 sm:w-48' : 'w-36'}
              value={modo === 'mes' ? janela.fromDay.slice(0, 7) : janela.fromDay}
              onChange={(e) => {
                const escolhido = e.target.value;
                if (!escolhido) return;
                emitir(periodoDoModo(modo, modo === 'mes' ? `${escolhido}-01` : escolhido, hoje), modo);
              }}
            />
            <button
              type="button"
              className={cn(botaoBase, 'w-9')}
              onClick={() => andar(1)}
              aria-label={modo === 'dia' ? 'Próximo dia' : modo === 'semana' ? 'Próxima semana' : 'Próximo mês'}
              title="Próximo"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
            {!noAtual && (
              <button
                type="button"
                className={cn(botaoBase, 'px-3')}
                onClick={() => emitir(periodoDoModo(modo, hoje, hoje), modo)}
              >
                {nomeDoAtual}
              </button>
            )}
          </div>
        )}

        {janela && modo === 'periodo' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${idPrefix}-de`}>
              De
            </label>
            <Input
              id={`${idPrefix}-de`}
              type="date"
              className="w-36"
              aria-label="De"
              value={valor?.period === 'custom' ? (valor.from ?? '') : janela.fromDay}
              onChange={(e) =>
                emitir(
                  valor?.period === 'custom'
                    ? { period: 'custom', from: e.target.value }
                    : { period: 'custom', from: e.target.value, to: janela.toDay },
                  'periodo',
                )
              }
            />
            <span className="text-sm text-muted">até</span>
            <label className="sr-only" htmlFor={`${idPrefix}-ate`}>
              Até
            </label>
            <Input
              id={`${idPrefix}-ate`}
              type="date"
              className="w-36"
              aria-label="Até"
              value={valor?.period === 'custom' ? (valor.to ?? '') : janela.toDay}
              onChange={(e) =>
                emitir(
                  valor?.period === 'custom'
                    ? { period: 'custom', to: e.target.value }
                    : { period: 'custom', from: janela.fromDay, to: e.target.value },
                  'periodo',
                )
              }
            />
            {(['last7', 'last30'] as const).map((atalho) => (
              <button
                key={atalho}
                type="button"
                aria-pressed={valor?.period === atalho}
                onClick={() => emitir({ period: atalho, from: null, to: null }, 'periodo')}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  valor?.period === atalho
                    ? 'border-accent-bright bg-accent-soft font-medium text-foreground'
                    : 'border-border text-muted hover:text-foreground',
                )}
              >
                {atalho === 'last7' ? 'Últimos 7 dias' : 'Últimos 30 dias'}
              </button>
            ))}
          </div>
        )}
      </div>

      {janela && modo && (
        <p className="text-xs text-muted" aria-live="polite">
          {modo === 'periodo' && valor?.period === 'last7'
            ? `Últimos 7 dias · ${diaCurto(janela.fromDay)} a ${diaCurto(janela.toDay)}`
            : modo === 'periodo' && valor?.period === 'last30'
              ? `Últimos 30 dias · ${diaCurto(janela.fromDay)} a ${diaCurto(janela.toDay)}`
              : rotuloDoPeriodo(modo, janela.fromDay, janela.toDay, hoje)}
          {modo === 'periodo' && valor?.from && valor.to && valor.from > valor.to && (
            <> — a data inicial é depois da final; considero o intervalo entre as duas assim mesmo.</>
          )}
        </p>
      )}
    </div>
  );
}
