"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export type ColumnFilterOption = { value: string; label: string };

/**
 * Extrae valores string únicos (trim, no vacíos) de `items[field]`, ordenados alfabéticamente.
 * Útil para armar `options` de {@link FilterableTh} a partir de filas cargadas (ej. juzgados).
 */
export function uniqueOptionsFromField<
  TItem extends Record<string, unknown>,
  TField extends keyof TItem & string,
>(items: readonly TItem[], field: TField, locale: Intl.LocalesArgument = "es"): ColumnFilterOption[] {
  const seen = new Set<string>();
  for (const item of items) {
    const raw = item[field];
    if (typeof raw !== "string") continue;
    const val = raw.trim();
    if (!val || seen.has(val)) continue;
    seen.add(val);
  }
  return [...seen]
    .sort((a, b) => a.localeCompare(b, locale, { sensitivity: "base" }))
    .map((value) => ({ value, label: value }));
}

export type UseColumnFiltersReturn<T extends string> = {
  filters: Record<T, string | null>;
  setFilter: (key: T, value: string | null) => void;
  clearFilter: (key: T) => void;
  clearAll: () => void;
  openFilter: T | null;
  setOpenFilter: Dispatch<SetStateAction<T | null>>;
  hasActiveFilters: boolean;
};

/**
 * Estado genérico de filtros por columna + menú abierto.
 * El `useEffect` de clic fuera cierra el menú (mismo patrón que `app/app/page.tsx`).
 */
export function useColumnFilters<T extends string>(
  initialFilters: Record<T, string | null>
): UseColumnFiltersReturn<T> {
  const [filters, setFilters] = useState<Record<T, string | null>>(() => ({ ...initialFilters }));
  const [openFilter, setOpenFilter] = useState<T | null>(null);

  useEffect(() => {
    if (openFilter === null) return;
    const close = () => setOpenFilter(null);
    const id = window.setTimeout(() => {
      document.addEventListener("click", close);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("click", close);
    };
  }, [openFilter]);

  const setFilter = useCallback((key: T, value: string | null) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilter = useCallback((key: T) => {
    setFilters((prev) => ({ ...prev, [key]: null }));
  }, []);

  const clearAll = useCallback(() => {
    setFilters((prev) => {
      const next = { ...prev } as Record<T, string | null>;
      for (const k of Object.keys(next) as T[]) {
        next[k] = null;
      }
      return next;
    });
  }, []);

  const hasActiveFilters = useMemo(() => {
    return (Object.values(filters) as (string | null)[]).some((v) => v !== null && v !== "");
  }, [filters]);

  return {
    filters,
    setFilter,
    clearFilter,
    clearAll,
    openFilter,
    setOpenFilter,
    hasActiveFilters,
  };
}
