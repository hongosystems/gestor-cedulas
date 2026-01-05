export type Semaforo = "ROJO" | "AMARILLO" | "VERDE";

export function daysBetweenToday(vtoISO: string) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(vtoISO); d.setHours(0,0,0,0);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

export function semaforo(dias: number, umbralAmarillo: number, umbralRojo: number): Semaforo {
  if (dias <= umbralRojo) return "ROJO";
  if (dias <= umbralAmarillo) return "AMARILLO";
  return "VERDE";
}
