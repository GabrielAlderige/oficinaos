import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'oficinaos:theme';
const listeners = new Set<() => void>();

const read = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // navegação privada ou armazenamento bloqueado: o tema só não é lembrado
  }
  listeners.forEach((listener) => listener());
}

/** Tema claro/escuro compartilhado por toda a tela. O inicial vem de index.html, antes da pintura. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, read, () => 'light' as Theme);
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}
