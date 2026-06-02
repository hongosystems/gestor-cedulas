/**
 * Enlace entre expedientes manuales (tabla expedientes) y favoritos PJN (pjn_favoritos).
 * Rollback rápido: NEXT_PUBLIC_EXPEDIENTE_PJN_MERGE=0
 * Rollback git: git checkout pre-expediente-pjn-merge
 */

export type ExpedienteMatchKey = {
  jurisdiccion: string;
  numero: string;
  anio: number;
};

export type PjnFavoritoForMerge = {
  id: string;
  jurisdiccion: string;
  numero: string;
  anio: number;
  caratula?: string | null;
  juzgado?: string | null;
  fecha_ultima_carga?: string | null;
  observaciones?: string | null;
  movimientos?: unknown;
  notas?: string | null;
};

export type LocalExpedienteForMerge = {
  id: string;
  caratula?: string | null;
  juzgado?: string | null;
  numero_expediente?: string | null;
  fecha_ultima_modificacion?: string | null;
  fecha_ultima_carga?: string | null;
  observaciones?: string | null;
  notas?: string | null;
  is_pjn_favorito?: boolean;
  [key: string]: unknown;
};

const DEFAULT_JURISDICCION = "CIV";

/** Desactivar merge sin revertir código (rollback operativo). */
export function isExpedientePjnMergeEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_EXPEDIENTE_PJN_MERGE;
  if (flag === "0" || flag === "false") return false;
  return true;
}

/** Número sin ceros a la izquierda para matching. */
export function normalizeNumeroExpediente(numero: string): string {
  const t = String(numero).trim();
  if (!t) return t;
  const stripped = t.replace(/^0+/, "");
  return stripped || "0";
}

/**
 * Parsea numero_expediente local: "CIV 35586/2025", "35586/2025", "CIV 035586/2025".
 */
export function parseExpedienteFromNumero(
  numeroExpediente: string | null | undefined,
  defaultJurisdiccion: string = DEFAULT_JURISDICCION
): ExpedienteMatchKey | null {
  if (!numeroExpediente?.trim()) return null;
  const text = numeroExpediente.trim().toUpperCase();

  let match = text.match(/^([A-Z]+)\s+(\d+)\/(\d{4})$/);
  if (!match) {
    match = text.match(/^(\d+)\/(\d{4})$/);
    if (match) {
      const [, numero, anioStr] = match;
      const anio = parseInt(anioStr, 10);
      if (isNaN(anio)) return null;
      return {
        jurisdiccion: defaultJurisdiccion,
        numero: normalizeNumeroExpediente(numero),
        anio,
      };
    }
    match = text.match(/\b([A-Z]+)\s+(\d+)\/(\d{4})\b/);
  }

  if (!match) return null;
  const [, jurisdiccion, numero, anioStr] = match;
  const anio = parseInt(anioStr, 10);
  if (!jurisdiccion || !numero || isNaN(anio)) return null;

  return {
    jurisdiccion: jurisdiccion.toUpperCase(),
    numero: normalizeNumeroExpediente(numero),
    anio,
  };
}

export function matchKeyFromParts(parts: ExpedienteMatchKey): string {
  return `${parts.jurisdiccion}|${parts.numero}|${parts.anio}`;
}

export function matchKeyFromFavorito(f: PjnFavoritoForMerge): string {
  return matchKeyFromParts({
    jurisdiccion: f.jurisdiccion.toUpperCase(),
    numero: normalizeNumeroExpediente(f.numero),
    anio: f.anio,
  });
}

export function matchKeyFromLocal(
  e: LocalExpedienteForMerge,
  defaultJurisdiccion?: string
): string | null {
  const parts = parseExpedienteFromNumero(e.numero_expediente, defaultJurisdiccion);
  if (!parts) return null;
  return matchKeyFromParts(parts);
}

/** Índice favorito → clave; si hay duplicados, conserva el de updated_at más reciente (caller puede ordenar antes). */
export function buildFavoritoMatchIndex(
  favoritos: PjnFavoritoForMerge[]
): Map<string, PjnFavoritoForMerge> {
  const map = new Map<string, PjnFavoritoForMerge>();
  for (const f of favoritos) {
    if (!f.jurisdiccion || f.anio == null || f.numero == null) continue;
    const key = matchKeyFromFavorito(f);
    map.set(key, f);
  }
  return map;
}

/** Mismo criterio que sync-favoritos / mis-juzgados fallback. */
export function extractObservacionesFromMovimientos(movimientos: unknown): string | null {
  if (!movimientos) return null;

  try {
    if (!Array.isArray(movimientos) || movimientos.length === 0) return null;

    let tipoActuacion: string | null = null;
    let detalle: string | null = null;

    for (let i = 0; i < movimientos.length; i++) {
      const mov = movimientos[i];
      if (typeof mov !== "object" || mov === null) continue;
      const cols = (mov as { cols?: unknown }).cols;
      if (!Array.isArray(cols)) continue;

      for (const col of cols) {
        const colStr = String(col).trim();
        if (!tipoActuacion) {
          const matchTipo = colStr.match(/^Tipo\s+actuacion:\s*(.+)$/i);
          if (matchTipo?.[1]?.trim()) {
            tipoActuacion = `Tipo actuacion: ${matchTipo[1].trim()}`;
          }
        }
        if (!detalle) {
          const matchDetalle = colStr.match(/^Detalle:\s*(.+)$/i);
          if (matchDetalle?.[1]?.trim()) {
            detalle = `Detalle: ${matchDetalle[1].trim()}`;
          }
        }
      }
      if (tipoActuacion && detalle) break;
    }

    if (tipoActuacion && detalle) return `${tipoActuacion}\n${detalle}`;
  } catch {
    // ignorar JSON malformado
  }
  return null;
}

export function resolveObservacionesFromFavorito(f: PjnFavoritoForMerge): string | null {
  const direct = f.observaciones?.trim();
  if (direct) return direct;
  return extractObservacionesFromMovimientos(f.movimientos);
}

function isBlank(value: string | null | undefined): boolean {
  return !value || !String(value).trim();
}

function pickNewerIsoDate(
  localIso: string | null | undefined,
  pjnDdMm: string | null | undefined,
  ddmmaaaaToISO: (ddmm: string | null) => string | null
): { iso: string | null; ddmm: string | null } {
  const pjnIso = pjnDdMm ? ddmmaaaaToISO(pjnDdMm) : null;
  const local = localIso?.trim() || null;

  if (!local && !pjnIso) {
    return { iso: null, ddmm: pjnDdMm?.trim() || null };
  }
  if (!local) {
    return { iso: pjnIso, ddmm: pjnDdMm?.trim() || null };
  }
  if (!pjnIso) {
    return { iso: local, ddmm: null };
  }

  const localTime = new Date(local).getTime();
  const pjnTime = new Date(pjnIso).getTime();
  if (!isNaN(pjnTime) && (isNaN(localTime) || pjnTime > localTime)) {
    return { iso: pjnIso, ddmm: pjnDdMm?.trim() || null };
  }
  return { iso: local, ddmm: null };
}

export type MergeLocalsOptions = {
  ddmmaaaaToISO: (ddmm: string | null) => string | null;
  normalizeJuzgado?: (raw: string | null | undefined) => string | null;
  defaultJurisdiccion?: string;
};

/**
 * Completa expedientes manuales con datos PJN y devuelve favoritos sin par local
 * (evita filas duplicadas en listados).
 */
export function mergeLocalsWithPjnFavoritos<T extends LocalExpedienteForMerge>(
  locals: T[],
  favoritos: PjnFavoritoForMerge[],
  options: MergeLocalsOptions
): { mergedLocals: T[]; unmatchedFavoritos: PjnFavoritoForMerge[]; mergedCount: number } {
  const { ddmmaaaaToISO, normalizeJuzgado, defaultJurisdiccion } = options;
  const index = buildFavoritoMatchIndex(favoritos);
  const consumed = new Set<string>();
  let mergedCount = 0;

  const mergedLocals = locals.map((local) => {
    if (local.is_pjn_favorito) return local;

    const key = matchKeyFromLocal(local, defaultJurisdiccion);
    if (!key) return local;

    const favorito = index.get(key);
    if (!favorito) return local;

    consumed.add(key);
    mergedCount += 1;

    const juzgadoPjn = normalizeJuzgado
      ? normalizeJuzgado(favorito.juzgado)
      : favorito.juzgado?.trim() || null;
    const observacionesPjn = resolveObservacionesFromFavorito(favorito);
    const fechas = pickNewerIsoDate(
      local.fecha_ultima_modificacion,
      favorito.fecha_ultima_carga,
      ddmmaaaaToISO
    );

    return {
      ...local,
      juzgado: isBlank(local.juzgado) ? juzgadoPjn : local.juzgado,
      observaciones: isBlank(local.observaciones) ? observacionesPjn : local.observaciones,
      caratula: isBlank(local.caratula) ? favorito.caratula ?? local.caratula : local.caratula,
      fecha_ultima_modificacion: fechas.iso ?? local.fecha_ultima_modificacion,
      fecha_ultima_carga: fechas.ddmm ?? local.fecha_ultima_carga,
      pjn_merge_applied: true,
      linked_pjn_favorito_id: favorito.id,
    } as T;
  });

  const unmatchedFavoritos = favoritos.filter((f) => !consumed.has(matchKeyFromFavorito(f)));

  return { mergedLocals, unmatchedFavoritos, mergedCount };
}

/** Evita dos filas del mismo expediente (manual enriquecido + favorito PJN). */
export function dedupeExpedientesByMatchKey<T extends LocalExpedienteForMerge & { is_pjn_favorito?: boolean }>(
  items: T[]
): T[] {
  const byKey = new Map<string, T>();

  const score = (item: T): number => {
    let s = 0;
    if ((item as { pjn_merge_applied?: boolean }).pjn_merge_applied) s += 4;
    if (!item.is_pjn_favorito) s += 2;
    if (item.juzgado?.trim()) s += 1;
    if (item.observaciones?.trim()) s += 1;
    return s;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const parsed = item.numero_expediente
      ? parseExpedienteFromNumero(item.numero_expediente)
      : null;
    const key =
      matchKeyFromLocal(item) || (parsed ? matchKeyFromParts(parsed) : null);
    if (!key) {
      byKey.set(`__no_key_${(item as { id?: string }).id ?? i}`, item);
      continue;
    }
    const prev = byKey.get(key);
    if (!prev || score(item) > score(prev)) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
}
