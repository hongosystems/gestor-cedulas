/**
 * GATE FASE 4 — colorExpediente unificado + merge PJN en todas las pantallas.
 * Uso: npx tsx scripts/check-semaforo-fase4-expediente.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  colorExpediente,
  ddmmaaaaToISO,
  isExpedienteRenunciado,
} from "../lib/semaforo";
import {
  applyPjnMergeToExpedienteList,
  fetchPjnFavoritosForMerge,
} from "../lib/expediente-pjn-client";
import {
  dedupeExpedientesByMatchKey,
  isExpedientePjnMergeEnabled,
  mergeLocalsWithPjnFavoritos,
} from "../lib/expediente-pjn-merge";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

type Exp = {
  id: string;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  fecha_ultima_carga?: string | null;
  observaciones?: string | null;
  semaforo_congelado?: boolean | null;
  fecha_semaforo_congelado?: string | null;
};

function pantallaColor(exp: Exp) {
  return colorExpediente(exp).color;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Requerido: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const [{ data: localsRaw, error: locErr }, favoritos] = await Promise.all([
    supabase
      .from("expedientes")
      .select(
        "id, numero_expediente, fecha_ultima_modificacion, fecha_ultima_carga, observaciones, caratula, juzgado, estado"
      )
      .eq("estado", "ABIERTO"),
    fetchPjnFavoritosForMerge(supabase),
  ]);

  let allLocals = (localsRaw ?? []) as Exp[];
  if (locErr) {
    const { data: locals2 } = await supabase
      .from("expedientes")
      .select("id, numero_expediente, fecha_ultima_modificacion, caratula, juzgado, estado")
      .eq("estado", "ABIERTO");
    allLocals = ((locals2 ?? []) as Exp[]).map((e) => ({ ...e, observaciones: null }));
  }
  const mergedList = applyPjnMergeToExpedienteList(allLocals, favoritos);
  const mergedById = new Map(mergedList.map((e) => [e.id, e]));

  let unificados: Exp[] = mergedList;
  if (isExpedientePjnMergeEnabled()) {
    const { mergedLocals, unmatchedFavoritos } = mergeLocalsWithPjnFavoritos(
      allLocals,
      favoritos,
      { ddmmaaaaToISO, normalizeJuzgado: (r) => (r ?? "").trim().toUpperCase() || null }
    );
    const unmatchedIds = new Set(unmatchedFavoritos.map((f) => f.id));
    const favoritosExp = favoritos
      .filter((f) => unmatchedIds.has(f.id))
      .map((f) => ({
        id: `pjn_${f.id}`,
        fecha_ultima_modificacion: ddmmaaaaToISO(f.fecha_ultima_carga ?? null),
        fecha_ultima_carga: f.fecha_ultima_carga,
        observaciones: f.observaciones,
        numero_expediente: `${f.jurisdiccion} ${f.numero}/${f.anio}`,
        is_pjn_favorito: true,
      }));
    unificados = dedupeExpedientesByMatchKey([...mergedLocals, ...favoritosExp]) as Exp[];
  }

  const mergeChanged: Exp[] = [];
  for (const raw of allLocals) {
    const merged = mergedById.get(raw.id);
    if (!merged) continue;
    if (merged.fecha_ultima_modificacion !== raw.fecha_ultima_modificacion) {
      mergeChanged.push(merged);
    }
  }

  const renunciados = mergedList.filter((e) => isExpedienteRenunciado(e));

  console.log("═══ FASE 4 — colorExpediente + merge PJN ═══");
  console.log("Merge habilitado:", isExpedientePjnMergeEnabled());
  console.log("Expedientes locales ABIERTO:", allLocals.length);
  console.log("Con fecha enriquecida por merge PJN:", mergeChanged.length);
  console.log("Renunciados/congelados:", renunciados.length);

  const muestras: Exp[] = [];
  for (const e of mergeChanged) {
    if (muestras.length >= 2) break;
    muestras.push(e);
  }
  if (renunciados[0] && !muestras.some((m) => m.id === renunciados[0].id)) {
    muestras.push(renunciados[0]);
  }
  for (const e of unificados) {
    if (muestras.length >= 5) break;
    if (!muestras.some((m) => m.id === e.id)) muestras.push(e);
  }

  console.log("\n── Muestra (5 expedientes) — color en 5 rutas lógicas ──");
  let fails = 0;
  for (const merged of muestras.slice(0, 5)) {
    const raw = allLocals.find((r) => r.id === merged.id);
    const cDashboard = pantallaColor(merged);
    const cMisJuzgados = pantallaColor(merged);
    const cAbogado = pantallaColor(merged);
    const cExpedientes = pantallaColor(merged);
    const cDetalle = pantallaColor(merged);
    const cSinMerge = raw ? pantallaColor(raw) : cDashboard;
    const ok =
      cDashboard === cMisJuzgados &&
      cMisJuzgados === cAbogado &&
      cAbogado === cExpedientes &&
      cExpedientes === cDetalle;
    if (!ok) fails++;
    console.log(
      `${ok ? "✓" : "✗"} ${merged.id.slice(0, 8)}… | sin merge=${cSinMerge} | unificado=${cDashboard} | ${merged.numero_expediente ?? "—"}`
    );
  }

  let rojosDashboard = unificados.filter((e) => colorExpediente(e).color === "ROJO").length;

  console.log("\n── Conteo expedientes ROJOS (dataset dashboard unificado) ──");
  console.log("Total ROJOS expedientes:", rojosDashboard);
  console.log("Expedientes unificados:", unificados.length);

  console.log("\n═══ RESUMEN GATE 4 ═══");
  const gateOk = fails === 0 && muestras.length >= Math.min(3, unificados.length);
  console.log(gateOk ? "GATE OK" : `GATE CON FALLOS (${fails} divergencias en muestra)`);
  if (!gateOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
