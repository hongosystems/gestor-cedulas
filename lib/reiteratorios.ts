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
