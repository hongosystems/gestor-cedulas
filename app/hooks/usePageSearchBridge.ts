"use client";

import { useEffect, useRef } from "react";
import { usePageSearchOptional } from "@/app/components/shell/PageSearchContext";

/**
 * Conecta el estado de búsqueda de la página al buscador global del topbar.
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
      ctxRef.current?.unbindPage();
      return;
    }
    const c = ctxRef.current;
    if (!c) return;

    c.bindPage((v) => onChangeRef.current(v));
    c.syncFromPage(value);

    return () => {
      c.unbindPage();
    };
  }, [enabled, value]);
}
