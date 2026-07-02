import {
  buildFavoritoMatchIndex,
  matchKeyFromFavorito,
  matchKeyFromLocal,
  matchKeyFromParts,
  parseExpedienteFromNumero,
  type PjnFavoritoForMerge,
} from "@/lib/expediente-pjn-merge";
import { tienePruebaPericia } from "@/lib/prueba-pericia-detect";

export type OrdenDeteccionRef = {
  case_ref: string | null;
  expediente_id: string | null;
  caratula?: string | null;
  juzgado?: string | null;
  numero_expediente?: string | null;
};

export type OrdenesDeteccionIndex = {
  matchKeys: Set<string>;
  expedienteIds: Set<string>;
  rawCaseRefs: Set<string>;
};

export function buildOrdenesDeteccionIndex(
  ordenes: OrdenDeteccionRef[]
): OrdenesDeteccionIndex {
  const matchKeys = new Set<string>();
  const expedienteIds = new Set<string>();
  const rawCaseRefs = new Set<string>();

  for (const orden of ordenes) {
    if (orden.expediente_id) expedienteIds.add(orden.expediente_id);
    for (const ref of [orden.case_ref, orden.numero_expediente]) {
      const trimmed = (ref || "").trim();
      if (!trimmed) continue;
      rawCaseRefs.add(trimmed);
      const parts = parseExpedienteFromNumero(trimmed);
      if (parts) matchKeys.add(matchKeyFromParts(parts));
    }
  }

  return { matchKeys, expedienteIds, rawCaseRefs };
}

export function expedienteMatchKey(exp: {
  id: string;
  numero_expediente?: string | null;
}): string {
  return matchKeyFromLocal(exp) || (exp.numero_expediente || "").trim() || exp.id;
}

export function findFavoritoForExpediente(
  exp: { numero_expediente?: string | null },
  favoritoIndex: Map<string, PjnFavoritoForMerge>
): PjnFavoritoForMerge | undefined {
  const parts = parseExpedienteFromNumero(exp.numero_expediente);
  if (!parts) return undefined;
  return favoritoIndex.get(matchKeyFromParts(parts));
}

export function buildFavoritoIndexFromList(
  favoritos: PjnFavoritoForMerge[]
): Map<string, PjnFavoritoForMerge> {
  return buildFavoritoMatchIndex(favoritos);
}

/** True si el expediente debe figurar en Detección (movimientos PJN u orden médica). */
export function incluirEnDeteccion(
  exp: {
    id: string;
    numero_expediente?: string | null;
    movimientos?: unknown;
  },
  ordenesIndex: OrdenesDeteccionIndex | null
): boolean {
  if (exp.movimientos && tienePruebaPericia(exp.movimientos)) return true;
  if (!ordenesIndex) return false;

  if (ordenesIndex.expedienteIds.has(exp.id)) return true;

  const key = matchKeyFromLocal(exp);
  if (key && ordenesIndex.matchKeys.has(key)) return true;

  const num = (exp.numero_expediente || "").trim();
  if (num && ordenesIndex.rawCaseRefs.has(num)) return true;

  return false;
}

export function ordenesDeteccionRefsFromApi(ordenes: any[]): OrdenDeteccionRef[] {
  return (ordenes || []).map((orden) => ({
    case_ref: orden.case_ref ?? null,
    expediente_id: orden.expediente_id ?? null,
    caratula: orden.expedientes?.caratula ?? null,
    juzgado: orden.expedientes?.juzgado ?? null,
    numero_expediente:
      orden.expedientes?.numero_expediente ?? orden.case_ref ?? null,
  }));
}

export function favoritoNumeroExpediente(f: PjnFavoritoForMerge): string {
  return `${f.numero}/${f.anio}`;
}

export function favoritoMatchKey(f: PjnFavoritoForMerge): string {
  return matchKeyFromFavorito(f);
}

/** Mapa rápido case_ref / matchKey / expediente_id → tiene orden. */
export function buildOrdenesExistentesMap(
  ordenes: OrdenDeteccionRef[]
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  const index = buildOrdenesDeteccionIndex(ordenes);

  for (const orden of ordenes) {
    for (const ref of [orden.case_ref, orden.numero_expediente, orden.expediente_id]) {
      const trimmed = (ref || "").trim();
      if (trimmed) map[trimmed] = true;
    }
  }
  for (const ref of index.rawCaseRefs) map[ref] = true;
  for (const key of index.matchKeys) map[key] = true;
  for (const id of index.expedienteIds) map[id] = true;

  return map;
}

/** True si la fila de Detección ya tiene orden médica (match flexible por número). */
export function itemTieneOrdenMedica(
  item: { id: string; numero?: string | null; is_pjn_favorito?: boolean },
  ordenesIndex: OrdenesDeteccionIndex | null,
  ordenesExistentes: Record<string, boolean>
): boolean {
  const num = (item.numero || "").trim();
  if (num && ordenesExistentes[num]) return true;
  if (ordenesExistentes[item.id]) return true;

  if (!ordenesIndex) return false;

  if (ordenesIndex.expedienteIds.has(item.id)) return true;

  const key = expedienteMatchKey({ id: item.id, numero_expediente: num });
  if (key && ordenesIndex.matchKeys.has(key)) return true;
  if (num && ordenesIndex.rawCaseRefs.has(num)) return true;

  const parts = parseExpedienteFromNumero(num);
  if (parts && ordenesIndex.matchKeys.has(matchKeyFromParts(parts))) return true;

  return false;
}
