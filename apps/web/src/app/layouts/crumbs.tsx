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

/** A página de detalhe troca "Cliente" pelo nome de verdade na trilha. */
export function usePageCrumb(label: string | undefined) {
  const { set } = useContext(CrumbContext);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!label) return;
    set(pathname, label);
    return () => set(pathname, null);
  }, [label, pathname, set]);
}
