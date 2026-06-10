export const REITERATORIO_PRESENTADO_PREFIX = "Reiteratorio presentado:";

export function isReiteratorioPresentado(
  observacionesPjn: string | null | undefined
): boolean {
  return (observacionesPjn || "").trim().startsWith(REITERATORIO_PRESENTADO_PREFIX);
}
