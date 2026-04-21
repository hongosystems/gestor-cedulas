// lib/semaforo.ts

export type SemaforoColor = "VERDE" | "AMARILLO" | "ROJO";

export const UMBRAL_AMARILLO_DIAS = 30; // desde 30 días = amarillo
export const UMBRAL_ROJO_DIAS = 60;     // desde 60 días = rojo
export const LEGACY_SEMAFORO_CUTOFF_DATE = process.env.NEXT_PUBLIC_SEMAFORO_LEGACY_CUTOFF_DATE || null;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseIsoDateOnly(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : startOfDay(d);
}

/**
 * Calcula los días desde una fecha, excluyendo los días de enero (feria judicial)
 * @param fechaCargaIso Fecha en formato ISO
 * @returns Número de días efectivos (excluyendo enero)
 */
export function daysSince(fechaCargaIso: string | null | undefined): number {
  if (!fechaCargaIso) return 0;
  const carga = new Date(fechaCargaIso);
  if (isNaN(carga.getTime())) return 0;

  const today = startOfDay(new Date());
  const base = startOfDay(carga);
  
  // Calcular días totales
  const diffMs = today.getTime() - base.getTime();
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  // Contar días de enero (feria judicial) en el rango
  let eneroDays = 0;
  const currentDate = new Date(base);
  
  while (currentDate <= today) {
    // Si el día actual es de enero (mes 0 en JavaScript), contarlo
    if (currentDate.getMonth() === 0) { // Enero es mes 0
      eneroDays++;
    }
    // Avanzar un día
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Retornar días efectivos (total - días de enero)
  return Math.max(0, totalDays - eneroDays);
}

/**
 * Calcula los días entre dos fechas, excluyendo los días de enero (feria judicial)
 * @param fechaInicioIso Fecha de inicio en formato ISO
 * @param fechaFinIso Fecha de fin en formato ISO
 * @returns Número de días efectivos entre las dos fechas (excluyendo enero)
 */
export function daysBetween(
  fechaInicioIso: string | null | undefined,
  fechaFinIso: string | null | undefined
): number {
  if (!fechaInicioIso || !fechaFinIso) return 0;
  const inicio = new Date(fechaInicioIso);
  const fin = new Date(fechaFinIso);
  if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) return 0;
  if (fin < inicio) return 0;

  const base = startOfDay(inicio);
  const endDate = startOfDay(fin);

  const diffMs = endDate.getTime() - base.getTime();
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let eneroDays = 0;
  const currentDate = new Date(base);

  while (currentDate <= endDate) {
    if (currentDate.getMonth() === 0) {
      eneroDays++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return Math.max(0, totalDays - eneroDays);
}

export function colorFromFechaCarga(fechaCargaIso: string | null | undefined): SemaforoColor {
  const d = daysSince(fechaCargaIso);

  if (d >= UMBRAL_ROJO_DIAS) return "ROJO";
  if (d >= UMBRAL_AMARILLO_DIAS) return "AMARILLO";
  return "VERDE";
}

/**
 * Indica si una fecha de carga cae antes (o en) la fecha de corte legacy
 * para evitar tratar registros históricos como "rojos" por antigüedad.
 */
export function isLegacySemaforoDate(fechaCargaIso: string | null | undefined): boolean {
  if (!fechaCargaIso || !LEGACY_SEMAFORO_CUTOFF_DATE) return false;
  const carga = new Date(fechaCargaIso);
  if (isNaN(carga.getTime())) return false;
  const cutoff = parseIsoDateOnly(LEGACY_SEMAFORO_CUTOFF_DATE);
  if (!cutoff) return false;
  return startOfDay(carga).getTime() <= cutoff.getTime();
}

export function labelFromColor(c: SemaforoColor) {
  if (c === "ROJO") return "ROJO";
  if (c === "AMARILLO") return "AMARILLO";
  return "VERDE";
}
