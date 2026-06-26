export function escapeIlikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/** Búsqueda por carátula: texto original del usuario. */
export function patternCaratula(q: string): string {
  return `%${escapeIlikePattern(q)}%`;
}

/**
 * Normaliza queries que parecen número de expediente (dígitos, /, -, prefijos CIV/COM…).
 * Ej: "CIV 087654/2024" → "87654/2024"
 */
export function normalizarBusquedaNumero(q: string): string {
  if (/^[\d\s/\-CIVOMLABCAFPENTRA]+$/i.test(q)) {
    return q
      .replace(/^(CIV|COM|LAB|CAF|PEN|TRAB)\s*/i, "")
      .replace(/\s+/g, "")
      .replace(/^0+/, "");
  }
  return q;
}

export function patternNumero(q: string): string {
  const normalized = normalizarBusquedaNumero(q);
  return `%${escapeIlikePattern(normalized)}%`;
}

export type PjnFavoritoSearchRow = {
  id: string;
  jurisdiccion: string | null;
  numero: string | null;
  anio: number | null;
  caratula: string | null;
  juzgado: string | null;
};

export function mergeSearchRows(
  ...groups: (PjnFavoritoSearchRow[] | null | undefined)[]
): PjnFavoritoSearchRow[] {
  const seen = new Set<string>();
  const merged: PjnFavoritoSearchRow[] = [];

  for (const group of groups) {
    for (const row of group ?? []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        merged.push(row);
      }
    }
  }

  return merged.slice(0, 20);
}
