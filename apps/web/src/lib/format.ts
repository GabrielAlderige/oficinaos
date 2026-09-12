const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const relativeFormat = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

/** "11/09/26, 14:32": para histórico (movimentos de estoque, auditoria). */
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

/** "agora", "há 5 minutos", "há 3 horas", "ontem", "em 6 dias". */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return 'agora';
  if (abs < 3600) return relativeFormat.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relativeFormat.format(Math.round(seconds / 3600), 'hour');
  return relativeFormat.format(Math.round(seconds / 86_400), 'day');
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** "Chrome no Windows", "Safari no iPhone/iPad": o suficiente para reconhecer o aparelho. */
export function describeUserAgent(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Aparelho desconhecido', mobile: false };
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Navegador';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iPhone/iPad'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'sistema desconhecido';
  return { label: `${browser} no ${os}`, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

/** Redireciono pós-login só para caminho interno (evita open redirect). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
