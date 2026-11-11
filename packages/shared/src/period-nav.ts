import { addDays, addMonths, startOfMonth, startOfWeek, type DashboardPeriod } from './calendar';

/**
 * As regras do seletor de período (dia, semana, mês ou intervalo, andando
 * com as setas). Ficam aqui, longe do React, para serem testadas sozinhas:
 * é aqui que "semana passada" vira 02/11 a 08/11, e um erro de um dia some
 * com o movimento de uma segunda-feira inteira do relatório.
 */

export type ModoDoPeriodo = 'dia' | 'semana' | 'mes' | 'periodo';

/** Último dia do mês de `dia`, sem depender de fuso. */
export function fimDoMes(dia: string): string {
  return addDays(addMonths(startOfMonth(dia), 1), -1);
}

/** Em que modo um período "se lê": 01 a 30/09 é um mês, 09 a 15/11 é uma semana. */
export function modoDoPeriodo(
  valor: { period: DashboardPeriod; from?: string | null; to?: string | null },
  hoje: string,
): ModoDoPeriodo {
  switch (valor.period) {
    case 'today':
      return 'dia';
    case 'week':
      return 'semana';
    case 'month':
      return 'mes';
    case 'last7':
    case 'last30':
      return 'periodo';
    case 'custom': {
      const de = valor.from ?? hoje;
      const ate = valor.to ?? hoje;
      if (de === ate) return 'dia';
      if (de === startOfWeek(de) && ate === addDays(de, 6)) return 'semana';
      if (de === startOfMonth(de) && ate === fimDoMes(de)) return 'mes';
      return 'periodo';
    }
  }
}

/**
 * O período de um modo, ancorado num dia. Se cair no período corrente, sai
 * com o NOME (today/week/month) — o servidor conta no fuso da oficina e o
 * link continua valendo amanhã ("este mês" no favorito vira o mês seguinte).
 */
export function periodoDoModo(
  modo: Exclude<ModoDoPeriodo, 'periodo'>,
  ancora: string,
  hoje: string,
): { period: DashboardPeriod; from: string | null; to: string | null } {
  if (modo === 'dia') {
    return ancora === hoje ? { period: 'today', from: null, to: null } : { period: 'custom', from: ancora, to: ancora };
  }
  if (modo === 'semana') {
    const inicio = startOfWeek(ancora);
    return inicio === startOfWeek(hoje)
      ? { period: 'week', from: null, to: null }
      : { period: 'custom', from: inicio, to: addDays(inicio, 6) };
  }
  const inicio = startOfMonth(ancora);
  return inicio === startOfMonth(hoje)
    ? { period: 'month', from: null, to: null }
    : { period: 'custom', from: inicio, to: fimDoMes(inicio) };
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const partes = (dia: string) => {
  const [ano, mes, d] = dia.split('-').map(Number) as [number, number, number];
  return { ano, mes, d };
};
export const diaCurto = (dia: string) => {
  const { mes, d } = partes(dia);
  return `${String(d).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
};
const diaDaSemana = (dia: string) => {
  const { ano, mes, d } = partes(dia);
  return DIAS_DA_SEMANA[new Date(Date.UTC(ano, mes - 1, d)).getUTCDay()]!;
};

/** "Hoje, terça 10/11", "Semana passada · 02/11 a 08/11", "Outubro de 2026". */
export function rotuloDoPeriodo(modo : ModoDoPeriodo, de: string, ate: string, hoje: string): string {
  if (modo === 'dia') {
    const prefixo = de === hoje ? 'Hoje, ' : de === addDays(hoje, -1) ? 'Ontem, ' : '';
    const semana = diaDaSemana(de);
    return `${prefixo}${prefixo ? semana : semana[0]!.toUpperCase() + semana.slice(1)} ${diaCurto(de)}${
      partes(de).ano === partes(hoje).ano ? '' : `/${partes(de).ano}`
    }`;
  }
  if (modo === 'semana') {
    const atual = startOfWeek(hoje);
    const nome = de === atual ? 'Esta semana' : de === addDays(atual, -7) ? 'Semana passada' : 'Semana';
    return `${nome} · ${diaCurto(de)} a ${diaCurto(ate)}${partes(ate).ano === partes(hoje).ano ? '' : `/${partes(ate).ano}`}`;
  }
  if (modo === 'mes') {
    const { ano, mes } = partes(de);
    const nome = MESES[mes - 1]!;
    return `${nome[0]!.toUpperCase()}${nome.slice(1)} de ${ano}`;
  }
  return `${diaCurto(de)}/${partes(de).ano} a ${diaCurto(ate)}/${partes(ate).ano}`;
}
