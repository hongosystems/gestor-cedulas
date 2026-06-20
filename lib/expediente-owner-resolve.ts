/**
 * Diagnóstico y asignación segura de owner en expedientes rojos sin responsable.
 * Dataset alineado con dashboard superadmin (merge PJN, sin inferir owner por juzgado).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { colorCedulaOficio, colorExpediente } from "./semaforo";
import {
  dedupeExpedientesByMatchKey,
  isExpedientePjnMergeEnabled,
  matchKeyFromLocal,
  matchKeyFromParts,
  mergeLocalsWithPjnFavoritos,
  parseExpedienteFromNumero,
  type PjnFavoritoForMerge,
} from "./expediente-pjn-merge";
import { juzgadoKeyFromRaw, type DocumentoRojoDashboard } from "./semaforo-dashboard-rojos";

export type OwnerCategoria = "A" | "B" | "C" | "D" | "E";

export type CedulaForOwnerSignal = {
  id: string;
  owner_user_id: string | null;
  ocr_exp_nro: string | null;
  tipo_documento: "CEDULA" | "OFICIO" | "OTROS_ESCRITOS" | null;
  estado?: string | null;
};

export type ExpedienteForOwner = {
  id: string;
  owner_user_id: string | null;
  caratula: string | null;
  juzgado: string | null;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  fecha_ultima_carga?: string | null;
  estado: string;
  is_pjn_favorito?: boolean;
  observaciones?: string | null;
};

export type PjnFavoritoRow = PjnFavoritoForMerge & {
  removido?: boolean | null;
  estado?: string | null;
};

export type OwnerSignal = {
  owners: string[];
  uniqueOwner: string | null;
  hasConflict: boolean;
  cedulaIds: string[];
};

export type ExpedienteSinOwnerItem = {
  id: string;
  caratula: string;
  juzgado: string | null;
  numeroExpediente: string | null;
  matchKey: string | null;
  isLocal: boolean;
  isPjnOnly: boolean;
  categoria: OwnerCategoria;
  ownerSignal: OwnerSignal | null;
  juzgadoUserIds: string[];
  proposedOwner: string | null;
  proposedSignal: string | null;
};

export type DiagExpedientesSinOwnerReport = {
  totalRojosSinOwner: number;
  counts: Record<OwnerCategoria, number>;
  aUnique: number;
  aConflict: number;
  dUnique: number;
  dConflict: number;
  items: ExpedienteSinOwnerItem[];
};

export const USAR_JUZGADO_COMO_OWNER_DEFAULT = false;

export type MonitoreoPJNStats = {
  total: number;
  rojos: number;
  amarillos: number;
  verdes: number;
};

/** Favorito PJN huérfano sin cédula/oficio propio del mismo caso — no es trabajo del estudio. */
export function esMonitoreoPJN(
  exp: Pick<ExpedienteForOwner, "id" | "numero_expediente" | "is_pjn_favorito">,
  localIds: Set<string>,
  cedulaOwnerIndex: Map<string, OwnerSignal>
): boolean {
  if (localIds.has(exp.id)) return false;
  if (!isPjnOnlyExpedienteId(exp.id)) return false;
  const matchKey = matchKeyForExpediente(exp as ExpedienteForOwner);
  if (!matchKey) return true;
  const signal = cedulaOwnerIndex.get(matchKey);
  return !(signal && signal.owners.length > 0);
}

export function computeMonitoreoPJNStats(
  expedientesUnificados: ExpedienteForOwner[],
  localIds: Set<string>,
  cedulaOwnerIndex: Map<string, OwnerSignal>
): MonitoreoPJNStats {
  let total = 0;
  let rojos = 0;
  let amarillos = 0;
  let verdes = 0;

  for (const e of expedientesUnificados) {
    if (!esMonitoreoPJN(e, localIds, cedulaOwnerIndex)) continue;
    total++;
    const resolved = colorExpediente(e);
    if (!resolved.fechaBase) continue;
    if (resolved.color === "ROJO") rojos++;
    else if (resolved.color === "AMARILLO") amarillos++;
    else verdes++;
  }

  return { total, rojos, amarillos, verdes };
}

export function filterTrabajoExpedientes<T extends ExpedienteForOwner>(
  expedientes: T[],
  localIds: Set<string>,
  cedulaOwnerIndex: Map<string, OwnerSignal>
): T[] {
  return expedientes.filter((e) => !esMonitoreoPJN(e, localIds, cedulaOwnerIndex));
}

function ownerExplicit(uid: string | null | undefined): string | null {
  return uid?.trim() ? uid.trim() : null;
}

export function normalizarJuzgadoOwner(j: string | null): string {
  if (!j) return "";
  const normalized = j.trim().replace(/\s+/g, " ").toUpperCase();
  const matchCivil = normalized.match(/JUZGADO\s+(?:NACIONAL\s+EN\s+LO\s+)?CIVIL\s+(?:N[°º]?\s*)?(\d+)/i);
  if (matchCivil?.[1]) return `JUZGADO CIVIL ${matchCivil[1]}`;
  const matchGeneric = normalized.match(/JUZGADO[^0-9]*?(\d+)/i);
  if (matchGeneric?.[1]) {
    if (normalized.includes("CIVIL")) return `JUZGADO CIVIL ${matchGeneric[1]}`;
    return normalized;
  }
  return normalized;
}

export function juzgadosCoincidenOwner(j1: string, j2: string): boolean {
  const n1 = normalizarJuzgadoOwner(j1);
  const n2 = normalizarJuzgadoOwner(j2);
  if (n1 === n2) return true;
  const num1 = n1.match(/(\d+)/)?.[1];
  const num2 = n2.match(/(\d+)/)?.[1];
  if (num1 && num2 && num1 === num2) {
    if (n1.includes("JUZGADO") && n2.includes("JUZGADO") && n1.includes("CIVIL") && n2.includes("CIVIL")) {
      return true;
    }
  }
  return false;
}

export function ddmmaaaaToISO(fecha: string | null): string | null {
  if (!fecha || fecha.trim() === "") return null;
  const fechaTrim = fecha.trim();
  const m1 = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fechaTrim);
  if (m1) {
    const [, dia, mes, anio] = m1;
    return `${anio}-${mes}-${dia}T00:00:00.000Z`;
  }
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaTrim);
  if (m2) {
    const [, anio, mes, dia] = m2;
    return `${anio}-${mes}-${dia}T00:00:00.000Z`;
  }
  return null;
}

export function isPjnOnlyExpedienteId(id: string): boolean {
  return id.startsWith("pjn_");
}

export function isLocalExpedienteId(id: string, localIds: Set<string>): boolean {
  return !isPjnOnlyExpedienteId(id) && localIds.has(id);
}

/** Índice matchKey → owners distintos desde cédulas/oficios abiertos con owner. */
export function buildCedulaOwnerIndex(cedulas: CedulaForOwnerSignal[]): Map<string, OwnerSignal> {
  const byKey = new Map<string, { owners: Set<string>; cedulaIds: string[] }>();

  for (const c of cedulas) {
    const owner = ownerExplicit(c.owner_user_id);
    if (!owner) continue;
    if (c.estado === "CERRADA") continue;
    const tipo = c.tipo_documento;
    if (tipo !== "CEDULA" && tipo !== "OFICIO") continue;

    const parts = parseExpedienteFromNumero(c.ocr_exp_nro);
    if (!parts) continue;
    const key = matchKeyFromParts(parts);
    const bucket = byKey.get(key) ?? { owners: new Set<string>(), cedulaIds: [] };
    bucket.owners.add(owner);
    bucket.cedulaIds.push(c.id);
    byKey.set(key, bucket);
  }

  const index = new Map<string, OwnerSignal>();
  for (const [key, bucket] of byKey) {
    const owners = [...bucket.owners];
    index.set(key, {
      owners,
      uniqueOwner: owners.length === 1 ? owners[0] : null,
      hasConflict: owners.length > 1,
      cedulaIds: bucket.cedulaIds,
    });
  }
  return index;
}

/** Usuarios cuyo user_juzgados coincide con el juzgado del expediente. */
export function usersForJuzgado(
  juzgado: string | null,
  userJuzgadosRows: { user_id: string; juzgado: string }[]
): string[] {
  if (!juzgado?.trim()) return [];
  const matched = new Set<string>();
  for (const row of userJuzgadosRows) {
    if (juzgadosCoincidenOwner(juzgado, row.juzgado)) {
      matched.add(row.user_id);
    }
  }
  return [...matched];
}

export function matchKeyForExpediente(exp: ExpedienteForOwner): string | null {
  return matchKeyFromLocal(exp);
}

export function categorizeExpedienteSinOwner(
  exp: ExpedienteForOwner,
  localIds: Set<string>,
  cedulaIndex: Map<string, OwnerSignal>,
  userJuzgadosRows: { user_id: string; juzgado: string }[],
  options?: { usarJuzgadoComoOwner?: boolean }
): ExpedienteSinOwnerItem {
  const isPjnOnly = isPjnOnlyExpedienteId(exp.id);
  const isLocal = isLocalExpedienteId(exp.id, localIds);
  const matchKey = matchKeyForExpediente(exp);
  const ownerSignal = matchKey ? cedulaIndex.get(matchKey) ?? null : null;
  const juzgadoUserIds = usersForJuzgado(exp.juzgado, userJuzgadosRows);

  let categoria: OwnerCategoria;
  let proposedOwner: string | null = null;
  let proposedSignal: string | null = null;

  if (isPjnOnly || (!isLocal && isPjnOnlyExpedienteId(exp.id))) {
    if (ownerSignal?.uniqueOwner) {
      categoria = "D";
      proposedOwner = ownerSignal.uniqueOwner;
      proposedSignal = `cedula_oficio_match:${matchKey}`;
    } else if (ownerSignal?.hasConflict) {
      categoria = "C";
    } else {
      categoria = "E";
    }
  } else if (isLocal) {
    if (ownerSignal?.uniqueOwner) {
      categoria = "A";
      proposedOwner = ownerSignal.uniqueOwner;
      proposedSignal = `cedula_oficio_match:${matchKey}`;
    } else if (ownerSignal?.hasConflict) {
      categoria = "C";
    } else if (juzgadoUserIds.length === 1) {
      categoria = "B";
      if (options?.usarJuzgadoComoOwner) {
        proposedOwner = juzgadoUserIds[0];
        proposedSignal = `juzgado_unico:${exp.juzgado}`;
      }
    } else {
      categoria = "C";
    }
  } else {
    // Favorito PJN sin prefijo pjn_ (edge) o fila huérfana
    if (ownerSignal?.uniqueOwner) {
      categoria = "D";
      proposedOwner = ownerSignal.uniqueOwner;
      proposedSignal = `cedula_oficio_match:${matchKey}`;
    } else if (ownerSignal?.hasConflict) {
      categoria = "C";
    } else {
      categoria = "E";
    }
  }

  return {
    id: exp.id,
    caratula: exp.caratula?.trim() || exp.numero_expediente?.trim() || "Sin carátula",
    juzgado: exp.juzgado?.trim() || null,
    numeroExpediente: exp.numero_expediente?.trim() || null,
    matchKey,
    isLocal,
    isPjnOnly: isPjnOnly || !isLocal,
    categoria,
    ownerSignal,
    juzgadoUserIds,
    proposedOwner,
    proposedSignal,
  };
}

export async function loadPjnFavoritosForOwner(supabase: SupabaseClient): Promise<PjnFavoritoRow[]> {
  const { data, error } = await supabase
    .from("pjn_favoritos")
    .select(
      "id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones, removido, estado"
    )
    .order("updated_at", { ascending: false });

  if (error) {
    const { data: data2, error: err2 } = await supabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones");
    if (err2) return [];
    return (data2 ?? []) as PjnFavoritoRow[];
  }

  return ((data ?? []) as PjnFavoritoRow[]).filter((f) => f.removido !== true && f.estado !== "REMOVIDO");
}

export function favoritosComoExpedientes(pjnFavoritos: PjnFavoritoRow[]): ExpedienteForOwner[] {
  return pjnFavoritos.map((favorito) => ({
    id: `pjn_${favorito.id}`,
    owner_user_id: "",
    caratula: favorito.caratula ?? null,
    juzgado: favorito.juzgado ?? null,
    numero_expediente: `${favorito.jurisdiccion} ${favorito.numero}/${favorito.anio}`,
    fecha_ultima_modificacion: ddmmaaaaToISO(favorito.fecha_ultima_carga ?? null),
    estado: "ABIERTO",
    is_pjn_favorito: true,
  }));
}

export function buildExpedientesUnificados(
  allExpedientes: ExpedienteForOwner[],
  pjnFavoritos: PjnFavoritoRow[]
): ExpedienteForOwner[] {
  const favoritosExp = favoritosComoExpedientes(pjnFavoritos);

  if (!isExpedientePjnMergeEnabled()) {
    const map = new Map<string, ExpedienteForOwner>();
    allExpedientes.forEach((e) => map.set(e.id, e));
    favoritosExp.forEach((e) => {
      if (!map.has(e.id)) map.set(e.id, e);
    });
    return Array.from(map.values());
  }

  const { mergedLocals, unmatchedFavoritos } = mergeLocalsWithPjnFavoritos(
    allExpedientes,
    pjnFavoritos,
    {
      ddmmaaaaToISO,
      normalizeJuzgado: (raw) => normalizarJuzgadoOwner(raw ?? null),
    }
  );

  const unmatchedIds = new Set(unmatchedFavoritos.map((f) => f.id));
  const favoritosSinParLocal = favoritosExp.filter((e) => {
    const favId = e.id.replace(/^pjn_/, "");
    return unmatchedIds.has(favId);
  });

  return dedupeExpedientesByMatchKey([...mergedLocals, ...favoritosSinParLocal]) as ExpedienteForOwner[];
}

export function buildRojosSinOwnerExpedientes(
  expedientesUnificados: ExpedienteForOwner[]
): ExpedienteForOwner[] {
  const out: ExpedienteForOwner[] = [];
  for (const e of expedientesUnificados) {
    const resolved = colorExpediente(e);
    if (resolved.color !== "ROJO") continue;
    if (!resolved.fechaBase) continue;
    if (ownerExplicit(e.owner_user_id)) continue;
    out.push(e);
  }
  return out;
}

export function buildDiagReport(
  rojosSinOwner: ExpedienteForOwner[],
  localIds: Set<string>,
  cedulaIndex: Map<string, OwnerSignal>,
  userJuzgadosRows: { user_id: string; juzgado: string }[],
  options?: { usarJuzgadoComoOwner?: boolean }
): DiagExpedientesSinOwnerReport {
  const counts: Record<OwnerCategoria, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  let aUnique = 0;
  let aConflict = 0;
  let dUnique = 0;
  let dConflict = 0;
  const items: ExpedienteSinOwnerItem[] = [];

  for (const exp of rojosSinOwner) {
    const item = categorizeExpedienteSinOwner(exp, localIds, cedulaIndex, userJuzgadosRows, options);
    items.push(item);
    counts[item.categoria]++;

    if (item.categoria === "A") {
      if (item.ownerSignal?.hasConflict) aConflict++;
      else if (item.ownerSignal?.uniqueOwner) aUnique++;
    }
    if (item.categoria === "D") {
      if (item.ownerSignal?.hasConflict) dConflict++;
      else if (item.ownerSignal?.uniqueOwner) dUnique++;
    }
  }

  return {
    totalRojosSinOwner: rojosSinOwner.length,
    counts,
    aUnique,
    aConflict,
    dUnique,
    dConflict,
    items,
  };
}

export type AssignPlanItem = ExpedienteSinOwnerItem & {
  action: "assign_owner" | "create_local_and_assign" | "manual" | "monitoreo";
};

export function buildAssignPlan(
  report: DiagExpedientesSinOwnerReport,
  options?: { usarJuzgadoComoOwner?: boolean }
): AssignPlanItem[] {
  return report.items.map((item) => {
    if (item.categoria === "A") {
      return { ...item, action: "assign_owner" as const };
    }
    if (item.categoria === "D") {
      return { ...item, action: "create_local_and_assign" as const };
    }
    if (item.categoria === "B" && options?.usarJuzgadoComoOwner && item.proposedOwner) {
      return { ...item, action: "assign_owner" as const };
    }
    if (item.categoria === "C") {
      return { ...item, action: "manual" as const, proposedOwner: null, proposedSignal: null };
    }
    return { ...item, action: "monitoreo" as const, proposedOwner: null, proposedSignal: null };
  });
}

export function toDocumentoRojoExpediente(exp: ExpedienteForOwner): DocumentoRojoDashboard {
  const resolved = colorExpediente(exp);
  return {
    id: exp.id,
    tipo: "EXPEDIENTE",
    tipoLabel: "Expediente",
    caratula: exp.caratula?.trim() || exp.numero_expediente?.trim() || "Sin carátula",
    juzgado: exp.juzgado?.trim() || null,
    juzgadoKey: juzgadoKeyFromRaw(exp.juzgado),
    dias: resolved.dias,
    ownerUserId: null,
    ownerName: "Sin responsable",
    href: "/superadmin/mis-juzgados",
  };
}
