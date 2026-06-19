import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isExpedientePjnMergeEnabled,
  mergeLocalsWithPjnFavoritos,
  type LocalExpedienteForMerge,
  type PjnFavoritoForMerge,
} from "./expediente-pjn-merge";
import { ddmmaaaaToISO } from "./semaforo";

/** Carga favoritos PJN para merge (filtra removidos). */
export async function fetchPjnFavoritosForMerge(
  supabase: SupabaseClient
): Promise<PjnFavoritoForMerge[]> {
  const { data, error } = await supabase
    .from("pjn_favoritos")
    .select(
      "id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones, movimientos, removido, estado"
    )
    .order("updated_at", { ascending: false });

  if (error) {
    const { data: data2 } = await supabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones");
    return (data2 ?? []) as PjnFavoritoForMerge[];
  }

  return ((data ?? []) as (PjnFavoritoForMerge & { removido?: boolean; estado?: string })[]).filter(
    (f) => f.removido !== true && f.estado !== "REMOVIDO"
  );
}

/** Enriquece expedientes locales con datos PJN (fecha más reciente, etc.) sin agregar favoritos huérfanos. */
export function applyPjnMergeToExpedienteList<T extends LocalExpedienteForMerge>(
  locals: T[],
  favoritos: PjnFavoritoForMerge[],
  normalizeJuzgado?: (raw: string | null | undefined) => string | null
): T[] {
  if (!isExpedientePjnMergeEnabled() || favoritos.length === 0 || locals.length === 0) {
    return locals;
  }
  const { mergedLocals } = mergeLocalsWithPjnFavoritos(locals, favoritos, {
    ddmmaaaaToISO,
    normalizeJuzgado,
  });
  return mergedLocals;
}

export function applyPjnMergeToSingleExpediente<T extends LocalExpedienteForMerge>(
  local: T,
  favoritos: PjnFavoritoForMerge[],
  normalizeJuzgado?: (raw: string | null | undefined) => string | null
): T {
  return applyPjnMergeToExpedienteList([local], favoritos, normalizeJuzgado)[0];
}
