import { UMBRALES } from "./semaforo";

export const REITERATORIO_PRESENTADO_PREFIX = "Reiteratorio presentado:";

/**
 * Umbral en días calendario desde `pjn_cargado_at` para candidatos a reiteratorio.
 *
 * **No es semáforo tricolor** — criterio operativo independiente de `colorPorDias` /
 * `daysSince`. Usa días calendario simples (incluye enero).
 */
export const REITERATORIO_UMBRAL_DIAS = UMBRALES.reiteratorioDias;

/** Días calendario desde una fecha ISO (reiteratorios — no excluye enero). */
export function diasCalendarioDesde(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  const diffMs = Date.now() - then;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function esCandidatoReiteratorio(pjnCargadoAt: string | null | undefined): boolean {
  if (!pjnCargadoAt) return false;
  return diasCalendarioDesde(pjnCargadoAt) >= REITERATORIO_UMBRAL_DIAS;
}

export function isReiteratorioPresentado(
  observacionesPjn: string | null | undefined
): boolean {
  return (observacionesPjn || "").trim().startsWith(REITERATORIO_PRESENTADO_PREFIX);
}

/** ISO de presentación guardado en `observaciones_pjn`, o null si no aplica. */
export function fechaPresentacionReiteratorio(
  observacionesPjn: string | null | undefined
): string | null {
  const text = (observacionesPjn || "").trim();
  if (!text.startsWith(REITERATORIO_PRESENTADO_PREFIX)) return null;
  const rest = text.slice(REITERATORIO_PRESENTADO_PREFIX.length).trim();
  if (!rest) return null;
  const date = new Date(rest);
  return Number.isNaN(date.getTime()) ? null : rest;
}

export function diasDesdePresentacionReiteratorio(
  observacionesPjn: string | null | undefined
): number | null {
  const iso = fechaPresentacionReiteratorio(observacionesPjn);
  if (!iso) return null;
  return diasCalendarioDesde(iso);
}
