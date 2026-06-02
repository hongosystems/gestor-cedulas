"use client";

/**
 * Puente opcional con el buscador del topbar (AppShell).
 * Sin shell desplegado, no hace nada — evita romper el build en producción.
 */
export function usePageSearchBridge(
  _value: string,
  _onChange: (value: string) => void,
  _enabled = true
) {
  // noop
}
