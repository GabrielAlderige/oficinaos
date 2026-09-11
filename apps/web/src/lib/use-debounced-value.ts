import { useEffect, useState } from 'react';

/** Espera a pessoa parar de digitar antes de buscar (uma requisição por pausa, não por tecla). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
