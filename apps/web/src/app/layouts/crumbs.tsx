import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';

interface CrumbContextValue {
  labels: Record<string, string>;
  set(path: string, label: string | null): void;
}

const CrumbContext = createContext<CrumbContextValue>({ labels: {}, set: () => undefined });

/** Rótulos dinâmicos da trilha ("Clientes › João Pereira") definidos pela própria página. */
export function CrumbProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const set = useCallback((path: string, label: string | null) => {
    setLabels((current) => {
      const next = { ...current };
      if (label) next[path] = label;
      else delete next[path];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ labels, set }), [labels, set]);
  return <CrumbContext.Provider value={value}>{children}</CrumbContext.Provider>;
}

export const useCrumbLabels = () => useContext(CrumbContext).labels;

/**
 * A página de detalhe troca "Cliente" pelo nome de verdade na trilha. Com
 * `path`, troca o rótulo de um nível acima (a cotação diz qual OS é a dela).
 */
export function usePageCrumb(label: string | undefined, path?: string) {
  const { set } = useContext(CrumbContext);
  const { pathname } = useLocation();
  const alvo = path ?? pathname;
  useEffect(() => {
    if (!label) return;
    set(alvo, label);
    return () => set(alvo, null);
  }, [label, alvo, set]);
}
