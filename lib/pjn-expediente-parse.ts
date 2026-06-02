/**
 * Parseo de claves PJN (cases.key / favoritos).
 * Principal: CIV 105060/2023  → numero "105060"
 * Incidente: CIV 105060/2023/1 → numero "105060/1" (expediente distinto)
 *
 * Scripts Node usan lib/pjn-expediente-parse.mjs (mantener alineado).
 */

export type ParsedPjnExpediente = {
  jurisdiccion: string;
  /** Número base o base/incidente, ej. "105060" | "105060/1" */
  numero: string;
  anio: number;
};

export function normalizeNumeroBase(numero: string): string {
  const t = String(numero).trim();
  const stripped = t.replace(/^0+/, "");
  return stripped || "0";
}

/** Normaliza numero almacenado en pjn_favoritos (preserva sufijo /N). */
export function normalizeNumeroStorage(numero: string): string {
  const t = String(numero).trim();
  const slashIdx = t.indexOf("/");
  if (slashIdx === -1) return normalizeNumeroBase(t);
  const base = normalizeNumeroBase(t.slice(0, slashIdx));
  const suffix = t.slice(slashIdx + 1).trim();
  return suffix ? `${base}/${suffix}` : base;
}

export function parseExpedienteFromCasesKey(
  expText: string | null | undefined
): ParsedPjnExpediente | null {
  if (!expText?.trim()) return null;
  const text = expText.trim().toUpperCase();

  // CIV 105060/2023/1 (incidente — año antes del sufijo)
  let match = text.match(/^([A-Z]+)\s+(\d+)\/(\d{4})\/(\d+)\s*$/);
  if (match) {
    const [, jurisdiccion, base, anioStr, incidente] = match;
    const anio = parseInt(anioStr, 10);
    if (isNaN(anio)) return null;
    return {
      jurisdiccion,
      numero: `${normalizeNumeroBase(base)}/${incidente}`,
      anio,
    };
  }

  // CIV 105060/2023 (principal)
  match = text.match(/^([A-Z]+)\s+(\d+)\/(\d{4})\s*$/);
  if (match) {
    const [, jurisdiccion, numero, anioStr] = match;
    const anio = parseInt(anioStr, 10);
    if (isNaN(anio)) return null;
    return {
      jurisdiccion,
      numero: normalizeNumeroBase(numero),
      anio,
    };
  }

  // Incrustado con incidente
  match = text.match(/\b([A-Z]+)\s+(\d+)\/(\d{4})\/(\d+)\b/);
  if (match) {
    const [, jurisdiccion, base, anioStr, incidente] = match;
    const anio = parseInt(anioStr, 10);
    if (isNaN(anio)) return null;
    return {
      jurisdiccion,
      numero: `${normalizeNumeroBase(base)}/${incidente}`,
      anio,
    };
  }

  // Incrustado principal
  match = text.match(/\b([A-Z]+)\s+(\d+)\/(\d{4})\b/);
  if (match) {
    const [, jurisdiccion, numero, anioStr] = match;
    const anio = parseInt(anioStr, 10);
    if (isNaN(anio)) return null;
    return {
      jurisdiccion,
      numero: normalizeNumeroBase(numero),
      anio,
    };
  }

  return null;
}

export function favoritoMatchKey(parts: ParsedPjnExpediente): string {
  return `${parts.jurisdiccion}|${normalizeNumeroStorage(parts.numero)}|${parts.anio}`;
}

export function favoritoMatchKeyFromRow(
  jurisdiccion: string,
  numero: string,
  anio: number
): string {
  return `${jurisdiccion.toUpperCase()}|${normalizeNumeroStorage(numero)}|${anio}`;
}

/** Variantes de clave para compatibilidad con filas legacy (solo principal sin /). */
export function favoritoMatchKeyVariants(parts: ParsedPjnExpediente): string[] {
  const keys = new Set<string>();
  keys.add(favoritoMatchKey(parts));
  if (!parts.numero.includes("/")) {
    keys.add(`${parts.jurisdiccion}|${parts.numero.padStart(6, "0")}|${parts.anio}`);
  }
  return [...keys];
}

export function formatNumeroExpedienteDisplay(
  jurisdiccion: string,
  numero: string,
  anio: number
): string {
  return `${jurisdiccion} ${numero}/${anio}`;
}
