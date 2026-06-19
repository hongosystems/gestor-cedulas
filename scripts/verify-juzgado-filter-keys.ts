/**
 * GATE — reconciliación claves filtro juzgado ↔ barras rojas.
 * Uso: npx tsx scripts/verify-juzgado-filter-keys.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { colorCedulaOficio, colorExpediente, ddmmaaaaToISO } from "../lib/semaforo";
import {
  applyPjnMergeToExpedienteList,
  fetchPjnFavoritosForMerge,
} from "../lib/expediente-pjn-client";
import {
  buildJuzgadoRojosChart,
  collectJuzgadoKeysFromSources,
  filterDocumentosRojos,
  juzgadoKeyFromRaw,
  matchesJuzgadoFilter,
  SIN_RESPONSABLE_LABEL,
  type DocumentoRojoDashboard,
} from "../lib/semaforo-dashboard-rojos";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

type CedulaRow = {
  id: string;
  owner_user_id: string | null;
  caratula: string | null;
  juzgado: string | null;
  fecha_carga: string | null;
  tipo_documento: string | null;
  pjn_cargado_at?: string | null;
  admin_cedulas_completada_at?: string | null;
  estado: string;
};

type ExpRow = {
  id: string;
  owner_user_id?: string | null;
  caratula: string | null;
  juzgado: string | null;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  observaciones?: string | null;
  semaforo_congelado?: boolean | null;
  fecha_semaforo_congelado?: string | null;
  estado?: string;
};

function buildDocumentosRojos(
  cedulas: CedulaRow[],
  expedientes: ExpRow[]
): DocumentoRojoDashboard[] {
  const items: DocumentoRojoDashboard[] = [];
  for (const c of cedulas) {
    const resolved = colorCedulaOficio(c);
    if (resolved.color !== "ROJO") continue;
    const tipo = c.tipo_documento === "OFICIO" ? "OFICIO" : "CEDULA";
    items.push({
      id: c.id,
      tipo,
      tipoLabel: tipo === "OFICIO" ? "Oficio" : "Cédula",
      caratula: c.caratula?.trim() || "Sin carátula",
      juzgado: c.juzgado?.trim() || null,
      juzgadoKey: juzgadoKeyFromRaw(c.juzgado),
      dias: resolved.dias,
      ownerUserId: c.owner_user_id?.trim() || null,
      ownerName: c.owner_user_id?.trim() ? "owner" : SIN_RESPONSABLE_LABEL,
      href: "/app",
    });
  }
  for (const e of expedientes) {
    const resolved = colorExpediente(e);
    if (!resolved.fechaBase || resolved.color !== "ROJO") continue;
    items.push({
      id: e.id,
      tipo: "EXPEDIENTE",
      tipoLabel: "Expediente",
      caratula: e.caratula?.trim() || e.numero_expediente?.trim() || "Sin carátula",
      juzgado: e.juzgado?.trim() || null,
      juzgadoKey: juzgadoKeyFromRaw(e.juzgado),
      dias: resolved.dias,
      ownerUserId: e.owner_user_id?.trim() || null,
      ownerName: e.owner_user_id?.trim() ? "owner" : SIN_RESPONSABLE_LABEL,
      href: "/superadmin/mis-juzgados",
    });
  }
  return items;
}

function filterByJuzgadoKey<T extends { juzgado?: string | null }>(
  rows: T[],
  filterKey: string
): T[] {
  return rows.filter((r) => matchesJuzgadoFilter(r.juzgado, filterKey));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Requerido: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  let gateOk = true;

  const [{ data: cedulasRaw }, { data: expsRaw }, favoritos] = await Promise.all([
    supabase
      .from("cedulas")
      .select(
        "id, owner_user_id, caratula, juzgado, fecha_carga, tipo_documento, pjn_cargado_at, admin_cedulas_completada_at, estado"
      )
      .neq("estado", "CERRADA"),
    supabase
      .from("expedientes")
      .select(
        "id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, observaciones, semaforo_congelado, fecha_semaforo_congelado, estado"
      )
      .eq("estado", "ABIERTO"),
    fetchPjnFavoritosForMerge(supabase),
  ]);

  const cedulas = (cedulasRaw ?? []) as CedulaRow[];
  let exps = (expsRaw ?? []) as ExpRow[];
  const merged = applyPjnMergeToExpedienteList(exps, favoritos);
  exps = merged as ExpRow[];

  const filterKeys = new Set(
    collectJuzgadoKeysFromSources([...cedulas, ...exps])
  );
  const documentosRojos = buildDocumentosRojos(cedulas, exps);
  const barKeys = new Set(
    buildJuzgadoRojosChart(documentosRojos).map((b) => b.drilldownKey!)
  );

  console.log("═══ GATE — claves filtro juzgado ↔ barras ═══\n");

  const missingInFilter = [...barKeys].filter((k) => !filterKeys.has(k));
  console.log("── 1. Cobertura (barras ⊆ filtro) ──");
  if (missingInFilter.length === 0) {
    console.log(`✓ ${barKeys.size} claves en barras, todas en filtro (${filterKeys.size} opciones)`);
  } else {
    gateOk = false;
    console.log(`✗ ${missingInFilter.length} clave(s) en barras ausentes del filtro:`);
    for (const k of missingInFilter) console.log(`  - ${k}`);
  }

  const orphan94 =
    filterKeys.has("94") &&
    ![...cedulas, ...exps].some((d) => juzgadoKeyFromRaw(d.juzgado) === "94");
  console.log("\n── 3. Sin fantasmas (ej. «94» huérfano) ──");
  if (!filterKeys.has("94")) {
    console.log('✓ No hay opción "94" suelta en el filtro');
  } else if (orphan94) {
    gateOk = false;
    console.log('✗ "94" en filtro sin documentos con esa clave');
  } else {
    console.log('✓ "94" presente solo si hay documentos con juzgadoKey === "94"');
  }

  const topBar = buildJuzgadoRojosChart(documentosRojos)[0];
  console.log("\n── 2. Selección reconcilia con barra top ──");
  if (!topBar?.drilldownKey) {
    console.log("(sin rojos en BD — chequeo omitido)");
  } else {
    const key = topBar.drilldownKey;
    const fromModal = filterDocumentosRojos(documentosRojos, "juzgado", key);
    const cedMatch = filterByJuzgadoKey(cedulas, key);
    const expMatch = filterByJuzgadoKey(exps, key);
    const rojosMatch = [
      ...cedMatch.filter((c) => colorCedulaOficio(c).color === "ROJO"),
      ...expMatch.filter((e) => colorExpediente(e).color === "ROJO"),
    ];
    const idsModal = new Set(fromModal.map((d) => d.id));
    const idsFilter = new Set(rojosMatch.map((d) => d.id));
    const onlyModal = [...idsModal].filter((id) => !idsFilter.has(id));
    const onlyFilter = [...idsFilter].filter((id) => !idsModal.has(id));

    console.log(`Top barra: "${key}" → ${topBar.value} rojos`);
    console.log(`  modal drill-down: ${fromModal.length}`);
    console.log(`  filtro clave exacta (rojos): ${rojosMatch.length}`);
    if (
      topBar.value === fromModal.length &&
      fromModal.length === rojosMatch.length &&
      onlyModal.length === 0 &&
      onlyFilter.length === 0
    ) {
      console.log("✓ Totales e IDs reconcilian");
    } else {
      gateOk = false;
      console.log(`✗ Divergencia modal=${fromModal.length} filtro=${rojosMatch.length}`);
      if (onlyModal.length) console.log(`  solo modal: ${onlyModal.slice(0, 5).join(", ")}`);
      if (onlyFilter.length) console.log(`  solo filtro: ${onlyFilter.slice(0, 5).join(", ")}`);
    }
  }

  const civil94Full = [...barKeys].find((k) => k.includes("CIVIL 94") && k.includes("SECRETAR"));
  if (civil94Full) {
    console.log(`\n── Caso Juzgado 94 ──`);
    console.log(`  clave barra: "${civil94Full}"`);
    console.log(`  en filtro: ${filterKeys.has(civil94Full) ? "✓" : "✗"}`);
    if (!filterKeys.has(civil94Full)) gateOk = false;
  }

  console.log("\n═══ RESUMEN ═══");
  console.log(gateOk ? "GATE OK" : "GATE CON FALLOS");
  if (!gateOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
