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
