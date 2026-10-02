import { DASHBOARD_PERIOD_LABELS, type DashboardPeriod } from '@oficinaos/shared';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Input } from './ui/input';

/**
 * Escolha de período, igual em toda tela que tem período.
 *
 * Os atalhos (hoje, semana, mês, últimos 7, últimos 30) vão para o servidor
 * como NOME, não como data: "hoje" numa oficina de Manaus começa uma hora
 * depois do que numa de São Paulo, e quem sabe o fuso da oficina é a API. Só
 * "Mês" e "Período" mandam data, porque aí quem escolheu o dia foi a pessoa e
 * não há o que interpretar.
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
 */
export function usePeriodoNaUrl(padrao: DashboardPeriod = 'month') {
  const [params, setParams] = useSearchParams();
  const escritaPendente = useRef<URLSearchParams | null>(null);
  const chave = params.toString();
  // a URL mudou: ela volta a ser a verdade (inclusive se outra coisa a mudou)
  useEffect(() => {
    escritaPendente.current = null;
  }, [chave]);

  const ler = (origem: URLSearchParams): Periodo => ({
    period: (origem.get('periodo') as DashboardPeriod | null) ?? padrao,
    from: origem.get('de') ?? undefined,
    to: origem.get('ate') ?? undefined,
  });
  const trocar = (patch: PeriodoPatch) => {
    const anterior = escritaPendente.current ?? params;
    const novo = aplicarPeriodo(ler(anterior), patch);
    const proximo = new URLSearchParams(anterior);
    proximo.set('periodo', novo.period);
    if (novo.from) proximo.set('de', novo.from);
    else proximo.delete('de');
    if (novo.to) proximo.set('ate', novo.to);
    else proximo.delete('ate');
    // período novo é lista nova: volta para a primeira página
    proximo.delete('page');
    escritaPendente.current = proximo;
    setParams(proximo, { replace: true });
  };
  return [ler(params), trocar] as const;
}

/** Primeiro os períodos do calendário (hoje, semana, mês), depois os corridos. */
const ATALHOS: DashboardPeriod[] = ['today', 'week', 'month', 'last7', 'last30'];

/** O valor do `<select>`: os atalhos são o próprio nome; mês e intervalo são modos. */
type Modo = DashboardPeriod | 'mes-escolhido';

const ehAtalho = (modo: Modo): modo is DashboardPeriod => ATALHOS.includes(modo as DashboardPeriod);

/** Último dia do mês "2026-09" → "2026-09-30", sem depender de fuso. */
function fimDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  if (!ano || !m) return mes;
  // dia 0 do mês seguinte é o último dia deste
  return `${mes}-${String(new Date(Date.UTC(ano, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

export function PeriodPicker({
  valor,
  onChange,
  idPrefix,
  className,
}: {
  valor: Periodo;
  onChange(patch: PeriodoPatch): void;
  /** prefixo dos ids, porque a tela pode ter mais de um seletor */
  idPrefix: string;
  className?: string;
}) {
  /**
   * Qual dos dois modos de data está aberto é escolha da PESSOA, guardada aqui.
   *
   * Deduzir isso das datas parece esperto e atrapalha: quem digita 01/09 a 30/09
   * em "Escolher período" veria os dois campos sumirem e virarem um seletor de
   * mês no meio da digitação, só porque o intervalo coincide com um mês inteiro.
   * O modo só muda quando a pessoa mexe no seletor.
   */
  const [modoDeData, setModoDeData] = useState<'mes-escolhido' | 'custom'>(() =>
    valor.period === 'custom' &&
    valor.from &&
    valor.to &&
    valor.from.endsWith('-01') &&
    valor.to === fimDoMes(valor.from.slice(0, 7))
      ? 'mes-escolhido'
      : 'custom',
  );
  const modo: Modo = valor.period !== 'custom' ? valor.period : modoDeData;

  const trocarModo = (novo: Modo) => {
    if (novo === 'mes-escolhido' || novo === 'custom') setModoDeData(novo);
    // atalho não usa data: limpa as duas para não sobrar lixo na URL
    if (ehAtalho(novo)) return onChange({ period: novo, from: null, to: null });
    if (novo === 'mes-escolhido') {
      const mes = (valor.from ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
      return onChange({ period: 'custom', from: `${mes}-01`, to: fimDoMes(mes) });
    }
    // intervalo livre: começa no que já estava, para a pessoa não perder o que escolheu
    const hoje = new Date().toISOString().slice(0, 10);
    return onChange({ period: 'custom', from: valor.from ?? hoje, to: valor.to ?? hoje });
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="sr-only" htmlFor={`${idPrefix}-periodo`}>
            Período
          </label>
          <select
            id={`${idPrefix}-periodo`}
            value={modo}
            onChange={(e) => trocarModo(e.target.value as Modo)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            {ATALHOS.map((atalho) => (
              <option key={atalho} value={atalho}>
                {DASHBOARD_PERIOD_LABELS[atalho]}
              </option>
            ))}
            <option value="mes-escolhido">Escolher mês</option>
            <option value="custom">Escolher período</option>
          </select>
        </div>

        {modo === 'mes-escolhido' && (
          <div>
            <label className="sr-only" htmlFor={`${idPrefix}-mes`}>
              Mês
            </label>
            <Input
              id={`${idPrefix}-mes`}
              type="month"
              className="w-48"
              value={(valor.from ?? '').slice(0, 7)}
              onChange={(e) => {
                const mes = e.target.value;
                if (mes) onChange({ period: 'custom', from: `${mes}-01`, to: fimDoMes(mes) });
              }}
            />
          </div>
        )}

        {modo === 'custom' && (
          <>
            <div>
              <label className="sr-only" htmlFor={`${idPrefix}-de`}>
                De
              </label>
              <Input
                id={`${idPrefix}-de`}
                type="date"
                className="w-36"
                aria-label="De"
                value={valor.from ?? ''}
                onChange={(e) => onChange({ period: 'custom', from: e.target.value })}
              />
            </div>
            <span className="pb-2 text-sm text-muted">até</span>
            <div>
              <label className="sr-only" htmlFor={`${idPrefix}-ate`}>
                Até
              </label>
              <Input
                id={`${idPrefix}-ate`}
                type="date"
                className="w-36"
                aria-label="Até"
                value={valor.to ?? ''}
                onChange={(e) => onChange({ period: 'custom', to: e.target.value })}
              />
            </div>
          </>
        )}
      </div>

      {modo === 'custom' && valor.from && valor.to && valor.from > valor.to && (
        <p className="mt-1.5 text-xs text-muted">
          A data inicial é depois da final — vou considerar o intervalo entre as duas assim mesmo.
        </p>
      )}
    </div>
  );
}
