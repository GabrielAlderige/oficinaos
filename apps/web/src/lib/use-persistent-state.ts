import { useCallback, useState } from 'react';

/** Preferência pequena lembrada no navegador (sidebar recolhida etc.). Nunca dado de negócio. */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // sem armazenamento: vale só nesta visita
      }
    },
    [key],
  );

  return [value, update] as const;
}
