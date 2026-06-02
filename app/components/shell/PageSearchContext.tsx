"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type PageSearchContextValue = {
  /** Valor mostrado en el topbar */
  value: string;
  /** Cambio desde el topbar → delega a la página registrada */
  onChange: (value: string) => void;
  isRegistered: boolean;
  /** Montaje de página: enlaza handlers (una vez por visita) */
  bindPage: (onChange: (value: string) => void) => void;
  unbindPage: () => void;
  /** La página actualiza su estado local → refleja en topbar sin re-registrar */
  syncFromPage: (value: string) => void;
};

const PageSearchContext = createContext<PageSearchContextValue | null>(null);

export function PageSearchProvider({ children }: { children: ReactNode }) {
  const [displayValue, setDisplayValue] = useState("");
  const [isRegistered, setIsRegistered] = useState(false);
  const pageOnChangeRef = useRef<((value: string) => void) | null>(null);

  const bindPage = useCallback((onChange: (value: string) => void) => {
    pageOnChangeRef.current = onChange;
    setIsRegistered(true);
  }, []);

  const unbindPage = useCallback(() => {
    pageOnChangeRef.current = null;
    setIsRegistered(false);
    setDisplayValue("");
  }, []);

  const syncFromPage = useCallback((value: string) => {
    setDisplayValue((prev) => (prev === value ? prev : value));
  }, []);

  const onChange = useCallback((value: string) => {
    setDisplayValue(value);
    pageOnChangeRef.current?.(value);
  }, []);

  const contextValue: PageSearchContextValue = {
    value: displayValue,
    onChange,
    isRegistered,
    bindPage,
    unbindPage,
    syncFromPage,
  };

  return (
    <PageSearchContext.Provider value={contextValue}>
      {children}
    </PageSearchContext.Provider>
  );
}

export function usePageSearch() {
  const ctx = useContext(PageSearchContext);
  if (!ctx) {
    throw new Error("usePageSearch debe usarse dentro de PageSearchProvider");
  }
  return ctx;
}

export function usePageSearchOptional() {
  return useContext(PageSearchContext);
}
