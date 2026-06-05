"use client";

import { useEffect, useRef } from "react";
import { usePageSearchOptional } from "@/app/components/shell/PageSearchContext";

/**
 * Conecta el estado de búsqueda de la página al buscador global del topbar.
 * El bind solo ocurre al montar/desmontar; no se re-hace en cada tecla.
 */
export function usePageSearchBridge(
  value: string,
  onChange: (value: string) => void,
  enabled = true
) {
  const ctx = usePageSearchOptional();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (!enabled) {
      // No desregistrar: otra vista (ej. BandejaView) puede ser dueña del bridge.
      return;
    }
    const c = ctxRef.current;
    if (!c) return;

    c.bindPage((v) => onChangeRef.current(v));
    onChangeRef.current(c.value);

    return () => {
      c.unbindPage();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    ctxRef.current?.syncFromPage(value);
  }, [enabled, value]);
}

/**
 * Valor efectivo para filtrar: prioriza lo que el usuario ve en el topbar.
 */
export function useEffectivePageSearch(localValue: string): string {
  const ctx = usePageSearchOptional();
  if (ctx?.isRegistered) {
    return ctx.value;
  }
  return localValue;
}
