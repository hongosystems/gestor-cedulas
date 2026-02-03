// lib/semaforo.ts

export type SemaforoColor = "VERDE" | "AMARILLO" | "ROJO";

export const UMBRAL_AMARILLO_DIAS = 30; // desde 30 días = amarillo
export const UMBRAL_ROJO_DIAS = 60;     // desde 60 días = rojo

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
