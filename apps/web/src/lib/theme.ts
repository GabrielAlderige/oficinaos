import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'oficinaos:theme';

function current(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Tema claro/escuro. O valor inicial já foi aplicado por index.html antes da pintura. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);

  const toggle = useCallback(() => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // navegação privada ou armazenamento bloqueado: o tema só não é lembrado
    }
    setTheme(next);
  }, []);

  return { theme, toggle };
}
