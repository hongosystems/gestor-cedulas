/**
 * Verificación FASE 3 — reconciliación drill-down vs Mis Juzgados (dataset = dashboard producción).
 * Uso: npx tsx scripts/verify-fase3-reconciliacion.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  colorCedulaOficio,
  colorExpediente,
  colorPorDias,
  daysSince,
  ddmmaaaaToISO,
  UMBRALES,
  type SemaforoColor,
} from "../lib/semaforo";
import {
  buildJuzgadoRojosChart,
  buildResponsableRojosChart,
  filterDocumentosRojos,
  juzgadoKeyFromRaw,
  SIN_RESPONSABLE_KEY,
  type DocumentoRojoDashboard,
  type DocumentoRojoTipo,
} from "../lib/semaforo-dashboard-rojos";
import {
  dedupeExpedientesByMatchKey,
  isExpedientePjnMergeEnabled,
  mergeLocalsWithPjnFavoritos,
} from "../lib/expediente-pjn-merge";

function formatRojosBreakdown(b: { exp: number; ced: number; of: number }): string {
  return `${b.exp} exp · ${b.ced} céd · ${b.of} of`;
}

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

// ─── Tipos mínimos (espejo dashboard / mis-juzgados) ─────────────────────────

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_carga: string | null;
  tipo_documento: "CEDULA" | "OFICIO" | "OTROS_ESCRITOS" | null;
  pjn_cargado_at?: string | null;
  admin_cedulas_completada_at?: string | null;
};

type Expediente = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  fecha_ultima_carga?: string | null;
  estado: string;
  is_pjn_favorito?: boolean;
};

type PjnFavorito = {
  id: string;
  jurisdiccion: string;
  numero: string;
  anio: number;
  caratula: string | null;
  juzgado: string | null;
  fecha_ultima_carga: string | null;
  observaciones: string | null;
  removido?: boolean | null;
  estado?: string | null;
  movimientos?: unknown;
};

type Profile = { id: string; full_name: string | null; email: string | null };

type RedItem = {
  docKey: string;
  id: string;
  tipo: DocumentoRojoTipo;
  juzgadoKey: string;
  ownerUserId: string | null;
  color: SemaforoColor;
  fechaBase: string | null;
  dias: number | null;
};

// ─── Helpers dashboard (copiados de app/superadmin/page.tsx) ────────────────

function ddmmaaaaToISO(fecha: string | null): string | null {
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

function normalizarJuzgadoDashboard(j: string | null): string {
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

function juzgadosCoincidenDashboard(j1: string, j2: string): boolean {
  const n1 = normalizarJuzgadoDashboard(j1);
  const n2 = normalizarJuzgadoDashboard(j2);
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

function semaforoExpedienteDashboard(e: Expediente): {
  color: SemaforoColor;
  dias: number;
  fechaBase: string | null;
} {
  const resolved = colorExpediente(e);
  return { color: resolved.color, dias: resolved.dias ?? 0, fechaBase: resolved.fechaBase };
}

function displayName(p?: Profile): string {
  const name = (p?.full_name || "").trim();
  if (name) return name;
  return (p?.email || "").trim() || "Sin nombre";
}

function docKey(tipo: DocumentoRojoTipo, id: string): string {
  return `${tipo}:${id}`;
}

// ─── Helpers Mis Juzgados (copiados de mis-juzgados/page.tsx sortedItems) ───

function normalizeJuzgadoMerge(raw: string | null): string | null {
  if (!raw) return null;
  const j = raw.trim().replace(/\s+/g, " ").toUpperCase();
  const mCivil = /^JUZGADO\s+CIVIL\s+(\d+)\b/i.exec(j);
  if (mCivil) return `JUZGADO CIVIL ${mCivil[1]}`;
  const stripped = j.replace(/\s*-\s*SECRETAR[ÍI]A\s*N[°º]?\s*\d+\s*.*$/i, "").trim();
  return stripped || null;
}

function misJuzgadosSemaforoExpediente(e: Expediente): {
  color: SemaforoColor;
  dias: number | null;
  fechaBase: string | null;
} {
  const resolved = colorExpediente({
    fecha_ultima_modificacion: e.fecha_ultima_modificacion,
    fecha_ultima_carga: e.fecha_ultima_carga,
    observaciones: (e as { observaciones?: string | null }).observaciones,
    semaforo_congelado: (e as { semaforo_congelado?: boolean }).semaforo_congelado,
    fecha_semaforo_congelado: (e as { fecha_semaforo_congelado?: string | null }).fecha_semaforo_congelado,
  });
  return {
    color: resolved.color,
    dias: resolved.dias,
    fechaBase: resolved.fechaBase,
  };
}

// ─── Carga de datos ─────────────────────────────────────────────────────────

async function loadPjnFavoritos(supabase: SupabaseClient): Promise<PjnFavorito[]> {
  const { data, error } = await supabase
    .from("pjn_favoritos")
    .select(
      "id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones, removido, estado, movimientos"
    )
    .order("updated_at", { ascending: false });

  if (error) {
    const { data: data2, error: err2 } = await supabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones");
    if (err2) {
      console.warn("pjn_favoritos:", err2.message);
      return [];
    }
    return (data2 ?? []) as PjnFavorito[];
  }

  return ((data ?? []) as PjnFavorito[]).filter((f) => f.removido !== true && f.estado !== "REMOVIDO");
}

function favoritosComoExpedientes(pjnFavoritos: PjnFavorito[]): Expediente[] {
  return pjnFavoritos.map((favorito) => ({
    id: `pjn_${favorito.id}`,
    owner_user_id: "",
    caratula: favorito.caratula,
    juzgado: favorito.juzgado,
    numero_expediente: `${favorito.jurisdiccion} ${favorito.numero}/${favorito.anio}`,
    fecha_ultima_modificacion: ddmmaaaaToISO(favorito.fecha_ultima_carga),
    estado: "ABIERTO",
    is_pjn_favorito: true,
  }));
}

function buildExpedientesUnificadosDashboard(
  allExpedientes: Expediente[],
  pjnFavoritos: PjnFavorito[]
): Expediente[] {
  const favoritosExp = favoritosComoExpedientes(pjnFavoritos);

  if (!isExpedientePjnMergeEnabled()) {
    const map = new Map<string, Expediente>();
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
      normalizeJuzgado: (raw) => normalizarJuzgadoDashboard(raw ?? null),
    }
  );

  const unmatchedIds = new Set(unmatchedFavoritos.map((f) => f.id));
  const favoritosSinParLocal = favoritosExp.filter((e) => {
    const favId = e.id.replace(/^pjn_/, "");
    return unmatchedIds.has(favId);
  });

  return dedupeExpedientesByMatchKey([...mergedLocals, ...favoritosSinParLocal]) as Expediente[];
}

function ownerExplicit(uid: string | null | undefined): string | null {
  return uid?.trim() ? uid.trim() : null;
}

function misJuzgadosMatchesResponsable(r: RedItem, key: string): boolean {
  if (key === SIN_RESPONSABLE_KEY) return !r.ownerUserId?.trim();
  return r.ownerUserId === key;
}

function buildDashboardDocumentosRojos(
  cedulas: Cedula[],
  expedientes: Expediente[],
  expedientesUnificados: Expediente[],
  profiles: Record<string, Profile>
): DocumentoRojoDashboard[] {
  const unificadosById = new Map(expedientesUnificados.map((e) => [e.id, e]));
  const items: DocumentoRojoDashboard[] = [];

  for (const c of cedulas) {
    const resolved = colorCedulaOficio(c);
    if (resolved.color !== "ROJO") continue;
    const tipo: DocumentoRojoTipo = c.tipo_documento === "OFICIO" ? "OFICIO" : "CEDULA";
    const ownerUserId = ownerExplicit(c.owner_user_id);
    items.push({
      id: c.id,
      tipo,
      tipoLabel: tipo === "OFICIO" ? "Oficio" : "Cédula",
      caratula: c.caratula?.trim() || "Sin carátula",
      juzgado: c.juzgado?.trim() || null,
      juzgadoKey: juzgadoKeyFromRaw(c.juzgado),
      dias: resolved.dias,
      ownerUserId,
      ownerName: ownerUserId ? displayName(profiles[ownerUserId]) : "Sin responsable",
      href: "/app",
    });
  }

  for (const e of expedientes) {
    const { color, dias, fechaBase } = semaforoExpedienteDashboard(e);
    if (!fechaBase || color !== "ROJO") continue;
    const base = unificadosById.get(e.id) ?? e;
    const ownerUserId = ownerExplicit(base.owner_user_id);
    items.push({
      id: e.id,
      tipo: "EXPEDIENTE",
      tipoLabel: "Expediente",
      caratula: e.caratula?.trim() || e.numero_expediente?.trim() || "Sin carátula",
      juzgado: e.juzgado?.trim() || null,
      juzgadoKey: juzgadoKeyFromRaw(e.juzgado),
      dias,
      ownerUserId,
      ownerName: ownerUserId ? displayName(profiles[ownerUserId]) : "Sin responsable",
      href: "/superadmin/mis-juzgados",
    });
  }

  return items;
}

/** Mis Juzgados juzgadoFilter=todos — merge + lista unificada */
function buildMisJuzgadosExpedientesTodos(
  allExpedientes: Expediente[],
  pjnFavoritos: PjnFavorito[]
): Expediente[] {
  let expedientesBase: Expediente[] = [...allExpedientes];
  let favoritosParaLista = [...pjnFavoritos];

  if (isExpedientePjnMergeEnabled()) {
    const { mergedLocals, unmatchedFavoritos } = mergeLocalsWithPjnFavoritos(
      expedientesBase,
      pjnFavoritos,
      {
        ddmmaaaaToISO,
        normalizeJuzgado: (raw) => normalizeJuzgadoMerge(raw ?? null),
      }
    );
    expedientesBase = mergedLocals as Expediente[];
    const unmatchedIds = new Set(unmatchedFavoritos.map((f) => f.id));
    favoritosParaLista = pjnFavoritos.filter((f) => unmatchedIds.has(f.id));
  }

  const favoritosComoExp: Expediente[] = favoritosParaLista.map((f) => ({
    id: `pjn_${f.id}`,
    owner_user_id: "",
    caratula: f.caratula,
    juzgado: f.juzgado,
    numero_expediente: `${f.jurisdiccion} ${f.numero}/${f.anio}`,
    fecha_ultima_modificacion: ddmmaaaaToISO(f.fecha_ultima_carga),
    fecha_ultima_carga: f.fecha_ultima_carga,
    estado: "ABIERTO",
    is_pjn_favorito: true,
  }));

  let combined = [...expedientesBase, ...favoritosComoExp];
  if (isExpedientePjnMergeEnabled()) {
    combined = dedupeExpedientesByMatchKey(combined) as Expediente[];
  }
  return combined;
}

function buildMisJuzgadosRedItems(cedulas: Cedula[], expedientes: Expediente[]): RedItem[] {
  const items: RedItem[] = [];

  for (const c of cedulas) {
    const isOficio = c.tipo_documento === "OFICIO";
    const tipo: DocumentoRojoTipo = isOficio ? "OFICIO" : "CEDULA";
    const resolved = colorCedulaOficio(c);
    if (resolved.color !== "ROJO") continue;
    items.push({
      docKey: docKey(tipo, c.id),
      id: c.id,
      tipo,
      juzgadoKey: juzgadoKeyFromRaw(c.juzgado),
      ownerUserId: ownerExplicit(c.owner_user_id),
      color: resolved.color,
      fechaBase: c.fecha_carga,
      dias: resolved.dias,
    });
  }

  for (const e of expedientes) {
    const { color, dias, fechaBase } = misJuzgadosSemaforoExpediente(e);
    if (color !== "ROJO") continue;
    items.push({
      docKey: docKey("EXPEDIENTE", e.id),
      id: e.id,
      tipo: "EXPEDIENTE",
      juzgadoKey: juzgadoKeyFromRaw(e.juzgado),
      ownerUserId: ownerExplicit(e.owner_user_id),
      color,
      fechaBase,
      dias,
    });
  }

  return items;
}

function operativoColor(item: RedItem, cedulasById: Map<string, Cedula>): SemaforoColor {
  if (item.tipo === "EXPEDIENTE") {
    return item.color; // mis-juzgados expediente path already used above in B
  }
  const c = cedulasById.get(item.id);
  if (!c) return "VERDE";
  return colorCedulaOficio(c).color;
}

function setDiff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x));
}

function countBreakdown(docs: { tipo: DocumentoRojoTipo }[]) {
  let exp = 0;
  let ced = 0;
  let of = 0;
  for (const d of docs) {
    if (d.tipo === "EXPEDIENTE") exp++;
    else if (d.tipo === "OFICIO") of++;
    else ced++;
  }
  return { exp, ced, of };
}

function computeDashboardMetrics(
  cedulas: Cedula[],
  expedientesUnificados: Expediente[],
  userJuzgadosMap: Record<string, string[]>
) {
  const cedulasConColor = cedulas.map((c) => ({ ...c, ...colorCedulaOficio(c) }));
  const cedulasConOwner = cedulasConColor.filter((c) => c.owner_user_id?.trim());

  const expedientesMap = new Map<string, Expediente>();
  expedientesUnificados.forEach((e) => {
    if (e.owner_user_id?.trim()) {
      expedientesMap.set(e.id, e);
      return;
    }
    if (!e.is_pjn_favorito || !e.juzgado) return;
    let assigned = false;
    for (const [, juzgadosDelUsuario] of Object.entries(userJuzgadosMap)) {
      if (juzgadosDelUsuario.some((j) => juzgadosCoincidenDashboard(e.juzgado || "", j))) {
        assigned = true;
        break;
      }
    }
    if (!assigned) return;
    for (const [userId, juzgadosDelUsuario] of Object.entries(userJuzgadosMap)) {
      if (juzgadosDelUsuario.some((j) => juzgadosCoincidenDashboard(e.juzgado || "", j))) {
        expedientesMap.set(e.id, { ...e, owner_user_id: userId });
        break;
      }
    }
  });
  const expedientesParaContar = Array.from(expedientesMap.values());

  let totalRojas = 0;
  let totalAmarillas = 0;
  let totalVerdes = 0;

  for (const c of cedulasConOwner) {
    if (c.color === "ROJO") totalRojas++;
    else if (c.color === "AMARILLO") totalAmarillas++;
    else totalVerdes++;
  }

  for (const e of expedientesParaContar) {
    if (!e.owner_user_id?.trim()) continue;
    const { color, fechaBase } = semaforoExpedienteDashboard(e);
    if (!fechaBase) continue;
    if (color === "ROJO") totalRojas++;
    else if (color === "AMARILLO") totalAmarillas++;
    else totalVerdes++;
  }

  const totalUniversoSemaforo = totalRojas + totalAmarillas + totalVerdes;
  const pct = (n: number) =>
    totalUniversoSemaforo > 0 ? ((n / totalUniversoSemaforo) * 100).toFixed(1) : "0";

  return {
    totalAbiertas: cedulas.length,
    totalUniversoSemaforo,
    totalRojas,
    totalAmarillas,
    totalVerdes,
    pctRojas: pct(totalRojas),
    pctAmarillas: pct(totalAmarillas),
    pctVerdes: pct(totalVerdes),
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Requerido: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);
  const mergeFlag = process.env.NEXT_PUBLIC_EXPEDIENTE_PJN_MERGE ?? "(unset → activo)";
  console.log("NEXT_PUBLIC_EXPEDIENTE_PJN_MERGE:", mergeFlag);
  console.log("Merge habilitado:", isExpedientePjnMergeEnabled());

  const [
    { data: cedulasRaw, error: cErr },
    { data: expsRaw, error: eErr },
    { data: profs },
    { data: userJuzgadosRows },
  ] = await Promise.all([
    supabase
      .from("cedulas")
      .select(
        "id, owner_user_id, caratula, juzgado, fecha_carga, tipo_documento, pjn_cargado_at, admin_cedulas_completada_at"
      )
      .neq("estado", "CERRADA"),
    supabase
      .from("expedientes")
      .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado")
      .eq("estado", "ABIERTO"),
    supabase.from("profiles").select("id, full_name, email"),
    supabase.from("user_juzgados").select("user_id, juzgado"),
  ]);

  if (cErr) throw cErr;
  if (eErr) throw eErr;

  const cedulas = (cedulasRaw ?? []) as Cedula[];
  const allExpedientes = (expsRaw ?? []) as Expediente[];
  const profiles: Record<string, Profile> = {};
  (profs ?? []).forEach((p) => {
    profiles[p.id] = p as Profile;
  });

  const userJuzgadosMap: Record<string, string[]> = {};
  (userJuzgadosRows ?? []).forEach((uj: { user_id: string; juzgado: string }) => {
    (userJuzgadosMap[uj.user_id] ||= []).push(uj.juzgado);
  });

  const pjnFavoritos = await loadPjnFavoritos(supabase);
  const expedientesUnificados = buildExpedientesUnificadosDashboard(allExpedientes, pjnFavoritos);
  const expedientesDashboard = expedientesUnificados;

  const documentosRojos = buildDashboardDocumentosRojos(
    cedulas,
    expedientesDashboard,
    expedientesUnificados,
    profiles
  );
  const misJuzgadosExpedientes = buildMisJuzgadosExpedientesTodos(allExpedientes, pjnFavoritos);
  const misJuzgadosRojos = buildMisJuzgadosRedItems(cedulas, misJuzgadosExpedientes);

  const bd = countBreakdown(documentosRojos);
  console.log("\n═══ PASO 1 — Dataset canónico (dashboard, filtro todos) ═══");
  console.log("Cédulas/oficios abiertos:", cedulas.length);
  console.log("Expedientes unificados:", expedientesUnificados.length);
  console.log("Expedientes en chart (state filtrado):", expedientesDashboard.length);
  console.log("Total ROJOS documentosRojos:", documentosRojos.length);
  console.log(`Desglose: (${bd.exp} exp · ${bd.ced} céd · ${bd.of} of)`);

  const cedulasById = new Map(cedulas.map((c) => [c.id, c]));
  const juzgadoCharts = buildJuzgadoRojosChart(documentosRojos);
  const responsableCharts = buildResponsableRojosChart(documentosRojos);
  const misJByKey = new Map<string, RedItem>();
  misJuzgadosRojos.forEach((r) => misJByKey.set(r.docKey, r));

  console.log("\n═══ PASO 2 — Reconciliación por JUZGADO (top 3) ═══");
  console.log("| Juzgado | Nº chart | Desglose | |A| | |B| | A−B | B−A | ¿OK? |");
  console.log("|---------|----------|----------|-----|-----|-----|-----|------|");

  let juzgadoFails = 0;
  for (const chart of juzgadoCharts.slice(0, 3)) {
    const setA = new Set(
      filterDocumentosRojos(documentosRojos, "juzgado", chart.drilldownKey!).map((d) =>
        docKey(d.tipo, d.id)
      )
    );
    const setB = new Set(
      misJuzgadosRojos.filter((r) => r.juzgadoKey === chart.drilldownKey).map((r) => r.docKey)
    );
    const aMinusB = setDiff(setA, setB);
    const bMinusA = setDiff(setB, setA);
    const realBd = countBreakdown(filterDocumentosRojos(documentosRojos, "juzgado", chart.drilldownKey!));
    const bdOk =
      chart.breakdown?.exp === realBd.exp &&
      chart.breakdown?.ced === realBd.ced &&
      chart.breakdown?.of === realBd.of;
    const ok = aMinusB.length === 0 && bMinusA.length === 0 && bdOk;
    if (!ok) juzgadoFails++;

    console.log(
      `| ${chart.label.slice(0, 40)} | ${chart.value} | ${chart.breakdown ? formatRojosBreakdown(chart.breakdown) : "—"} | ${setA.size} | ${setB.size} | ${aMinusB.length} | ${bMinusA.length} | ${ok ? "✓" : "✗"} |`
    );

    if (aMinusB.length || bMinusA.length) {
      for (const k of [...aMinusB, ...bMinusA].slice(0, 8)) {
        const aDoc = documentosRojos.find((d) => docKey(d.tipo, d.id) === k);
        const bDoc = misJByKey.get(k);
        const id = k.split(":")[1];
        let diag: Record<string, unknown> = {};
        if (k.startsWith("CEDULA:") || k.startsWith("OFICIO:")) {
          const c = cedulasById.get(id);
          if (c) {
            const dash = colorCedulaOficio(c);
            const mj = colorCedulaOficio(c);
            diag = {
              fecha_carga: c.fecha_carga,
              pjn_cargado_at: c.pjn_cargado_at ?? null,
              admin_cedulas_completada_at: c.admin_cedulas_completada_at ?? null,
              dashboard_color: dash.color,
              misJuzgados_color: mj.color,
            };
          }
        } else if (k.startsWith("EXPEDIENTE:")) {
          const expD = expedientesDashboard.find((e) => e.id === id);
          const expM = misJuzgadosExpedientes.find((e) => e.id === id);
          diag = {
            dashboard_owner: expD?.owner_user_id ?? null,
            misJuzgados_owner: expM?.owner_user_id ?? null,
            is_pjn: expD?.is_pjn_favorito ?? expM?.is_pjn_favorito ?? false,
            fecha_ultima_modificacion: expD?.fecha_ultima_modificacion ?? expM?.fecha_ultima_modificacion,
          };
        }
        console.log("  DIVERGENTE", k, {
          enChart: !!aDoc,
          enMisJuzgados: !!bDoc,
          ...diag,
        });
      }
    }
  }

  console.log("\n═══ PASO 3 — Reconciliación por RESPONSABLE (top 3) ═══");
  console.log("| Responsable | Nº chart | Desglose | |A| | |B| | A−B | B−A | ¿OK? |");
  console.log("|-------------|----------|----------|-----|-----|-----|-----|------|");

  let respFails = 0;
  for (const chart of responsableCharts.slice(0, 3)) {
    const setA = new Set(
      filterDocumentosRojos(documentosRojos, "responsable", chart.drilldownKey!).map((d) =>
        docKey(d.tipo, d.id)
      )
    );
    const setB = new Set(
      misJuzgadosRojos
        .filter((r) => misJuzgadosMatchesResponsable(r, chart.drilldownKey!))
        .map((r) => r.docKey)
    );
    const aMinusB = setDiff(setA, setB);
    const bMinusA = setDiff(setB, setA);
    const ok = aMinusB.length === 0 && bMinusA.length === 0;
    if (!ok) respFails++;

    console.log(
      `| ${chart.label.slice(0, 35)} | ${chart.value} | ${chart.breakdown ? formatRojosBreakdown(chart.breakdown) : "—"} | ${setA.size} | ${setB.size} | ${aMinusB.length} | ${bMinusA.length} | ${ok ? "✓" : "✗"} |`
    );

    if (aMinusB.length || bMinusA.length) {
      for (const k of [...aMinusB, ...bMinusA].slice(0, 8)) {
        const id = k.split(":")[1];
        let diag: Record<string, unknown> = {};
        if (k.startsWith("CEDULA:") || k.startsWith("OFICIO:")) {
          const c = cedulasById.get(id);
          if (c) {
            const dash = colorCedulaOficio(c);
            const mj = colorCedulaOficio(c);
            diag = {
              dashboard_color: dash.color,
              misJuzgados_color: mj.color,
              admin_cedulas_completada_at: c.admin_cedulas_completada_at ?? null,
            };
          }
        } else if (k.startsWith("EXPEDIENTE:")) {
          const expD = expedientesDashboard.find((e) => e.id === id);
          const expM = misJuzgadosExpedientes.find((e) => e.id === id);
          diag = {
            dashboard_owner: expD?.owner_user_id ?? null,
            misJuzgados_owner: expM?.owner_user_id ?? null,
            is_pjn: !!(expD?.is_pjn_favorito ?? expM?.is_pjn_favorito),
          };
        }
        console.log("  DIVERGENTE", k, { lado: aMinusB.includes(k) ? "solo chart" : "solo Mis Juzgados", ...diag });
      }
    }
  }

  console.log("\n═══ PASO 4 — Color modal ↔ pantalla operativa (5 docs) ═══");
  const muestra = documentosRojos.slice(0, 5);
  let paso4Fails = 0;
  for (const d of muestra) {
    const key = docKey(d.tipo, d.id);
    const modalColor = "ROJO";
    let operativo: SemaforoColor;
    let pantalla: string;
    if (d.tipo === "EXPEDIENTE") {
      const exp =
        expedientesDashboard.find((e) => e.id === d.id) ||
        misJuzgadosExpedientes.find((e) => e.id === d.id);
      operativo = exp ? misJuzgadosSemaforoExpediente(exp).color : "VERDE";
      pantalla = "Mis Juzgados (expediente)";
    } else {
      operativo = colorCedulaOficio(cedulasById.get(d.id)!).color;
      pantalla = "Mis Cédulas (colorCedulaOficio)";
    }
    const ok = modalColor === "ROJO" && operativo === "ROJO";
    if (!ok) paso4Fails++;
    console.log(
      `${ok ? "✓" : "✗"} ${key} | modal=${modalColor} | ${pantalla}=${operativo} | ${d.caratula.slice(0, 45)}`
    );
  }

  console.log("\n═══ PASO 5 — Porcentajes (misma fórmula panel + Métricas Generales) ═══");
  const m = computeDashboardMetrics(cedulas, expedientesUnificados, userJuzgadosMap);
  const suma =
    parseFloat(m.pctRojas) + parseFloat(m.pctAmarillas) + parseFloat(m.pctVerdes);
  console.log("Documentos abiertos (céd+of):", m.totalAbiertas);
  console.log("Universo semáforo:", m.totalUniversoSemaforo);
  console.log("Panel superior = Métricas Generales:");
  console.log(`  ROJO: ${m.pctRojas}% (${m.totalRojas})`);
  console.log(`  AMARILLO: ${m.pctAmarillas}% (${m.totalAmarillas})`);
  console.log(`  VERDE: ${m.pctVerdes}% (${m.totalVerdes})`);
  console.log(`Suma: ${suma.toFixed(1)}% ${Math.abs(suma - 100) <= 1 ? "✓" : "✗"}`);

  console.log("\n═══ RESUMEN GATE ═══");
  const gateOk = juzgadoFails === 0 && respFails === 0 && paso4Fails === 0 && Math.abs(suma - 100) <= 1;
  console.log(
    gateOk
      ? "GATE OK — conjuntos reconciliados (o divergencias documentadas arriba para diagnóstico FASE 4)"
      : `GATE CON FALLOS — juzgados:${juzgadoFails} responsables:${respFails} paso4:${paso4Fails} pct:${Math.abs(suma - 100) > 1 ? "fail" : "ok"}`
  );

  if (!gateOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
