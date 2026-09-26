import { useSyncExternalStore } from 'react';

/**
 * Responde a uma media query e re-renderiza quando ela muda (girar o celular,
 * arrastar a janela). `useSyncExternalStore` em vez de `useState` + efeito
 * porque o primeiro render já sai com a resposta certa — sem piscar a versão
 * errada da tela.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const lista = window.matchMedia(query);
      lista.addEventListener('change', avisar);
      return () => lista.removeEventListener('change', avisar);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** O mesmo corte do `lg:` do Tailwind, que é onde a barra lateral aparece. */
export const useIsPhone = () => useMediaQuery('(max-width: 1023px)');
