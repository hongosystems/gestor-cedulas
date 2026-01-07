// lib/semaforo.ts

export type SemaforoColor = "VERDE" | "AMARILLO" | "ROJO";

export const UMBRAL_AMARILLO_DIAS = 30; // desde 30 días = amarillo
export const UMBRAL_ROJO_DIAS = 60;     // desde 60 días = rojo

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysSince(fechaCargaIso: string | null | undefined): number {
  if (!fechaCargaIso) return 0;
  const carga = new Date(fechaCargaIso);
  if (isNaN(carga.getTime())) return 0;

  const today = startOfDay(new Date());
  const base = startOfDay(carga);
  const diffMs = today.getTime() - base.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function colorFromFechaCarga(fechaCargaIso: string | null | undefined): SemaforoColor {
  const d = daysSince(fechaCargaIso);

  if (d >= UMBRAL_ROJO_DIAS) return "ROJO";
  if (d >= UMBRAL_AMARILLO_DIAS) return "AMARILLO";
  return "VERDE";
}

export function labelFromColor(c: SemaforoColor) {
  if (c === "ROJO") return "ROJO";
  if (c === "AMARILLO") return "AMARILLO";
  return "VERDE";
}
