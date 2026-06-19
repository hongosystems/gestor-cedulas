/**
 * GATE 3 — muestra desglose y lista modal para Juzgado 20 y Micaela Heinrich.
 * Uso: npx tsx scripts/check-semaforo-fase3-drilldown.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { colorCedulaOficio, colorPorDias, daysSince, UMBRALES } from "../lib/semaforo";
import {
  buildJuzgadoRojosChart,
  buildResponsableRojosChart,
  filterDocumentosRojos,
  juzgadoKeyFromRaw,
  type DocumentoRojoDashboard,
} from "../lib/semaforo-dashboard-rojos";
import { formatRojosBreakdown } from "../app/components/ui/CssBarChart";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

function semaforoExpediente(fecha: string | null) {
  if (!fecha) return { color: "VERDE" as const, dias: 0 };
  const dias = daysSince(fecha);
  return { color: colorPorDias(dias, UMBRALES.expediente), dias };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) process.exit(1);

  const supabase = createClient(url, key);

  const [{ data: cedulas }, { data: expedientes }, { data: profiles }] = await Promise.all([
    supabase
      .from("cedulas")
      .select("id, owner_user_id, caratula, juzgado, fecha_carga, tipo_documento, pjn_cargado_at, admin_cedulas_completada_at")
      .neq("estado", "CERRADA"),
    supabase
      .from("expedientes")
      .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion")
      .neq("estado", "CERRADA"),
    supabase.from("profiles").select("id, full_name, email"),
  ]);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const nameOf = (uid: string | null) => {
    if (!uid) return "Sin nombre";
    const p = profileMap.get(uid);
    return (p?.full_name || p?.email || uid).trim();
  };

  const documentos: DocumentoRojoDashboard[] = [];

  for (const c of cedulas ?? []) {
    const resolved = colorCedulaOficio(c);
    if (resolved.color !== "ROJO") continue;
    const tipo = c.tipo_documento === "OFICIO" ? "OFICIO" : "CEDULA";
    documentos.push({
      id: c.id,
      tipo,
      tipoLabel: tipo === "OFICIO" ? "Oficio" : "Cédula",
      caratula: c.caratula?.trim() || "Sin carátula",
      juzgado: c.juzgado?.trim() || null,
      juzgadoKey: juzgadoKeyFromRaw(c.juzgado),
      dias: resolved.dias,
      ownerUserId: c.owner_user_id,
      ownerName: nameOf(c.owner_user_id),
      href: "/app",
    });
  }

  for (const e of expedientes ?? []) {
    if (!e.fecha_ultima_modificacion) continue;
    const { color, dias } = semaforoExpediente(e.fecha_ultima_modificacion);
    if (color !== "ROJO") continue;
    documentos.push({
      id: e.id,
      tipo: "EXPEDIENTE",
      tipoLabel: "Expediente",
      caratula: e.caratula?.trim() || e.numero_expediente?.trim() || "Sin carátula",
      juzgado: e.juzgado?.trim() || null,
      juzgadoKey: juzgadoKeyFromRaw(e.juzgado),
      dias,
      ownerUserId: e.owner_user_id,
      ownerName: nameOf(e.owner_user_id),
      href: "/superadmin/mis-juzgados",
    });
  }

  const juzgados = buildJuzgadoRojosChart(documentos);
  const responsables = buildResponsableRojosChart(documentos);

  const j20 = juzgados.find(
    (j) => /\b20\b/.test(j.label) || j.label.toLowerCase().includes("juzgado 20")
  );
  const micaela = responsables.find((r) =>
    r.label.toLowerCase().includes("micaela") && r.label.toLowerCase().includes("heinrich")
  );

  console.log("\n=== GATE 3 — Juzgado 20 (match por label) ===");
  if (j20) {
    console.log("Label:", j20.label);
    console.log("Total rojos:", j20.value, j20.breakdown ? formatRojosBreakdown(j20.breakdown) : "");
    const lista = filterDocumentosRojos(documentos, "juzgado", j20.drilldownKey!);
    console.log("Documentos en modal:", lista.length);
    for (const d of lista) {
      console.log(`  - [${d.tipoLabel}] ${d.caratula.slice(0, 50)} | ${d.dias ?? "—"} d | ${d.href}`);
    }
  } else {
    console.log("No se encontró juzgado con '20' en el label. Top 5 juzgados:");
    juzgados.slice(0, 5).forEach((j) =>
      console.log(`  ${j.label}: ${j.value} ${j.breakdown ? formatRojosBreakdown(j.breakdown) : ""}`)
    );
  }

  console.log("\n=== GATE 3 — Micaela Heinrich ===");
  if (micaela) {
    console.log("Responsable:", micaela.label);
    console.log("Total rojos:", micaela.value, micaela.breakdown ? formatRojosBreakdown(micaela.breakdown) : "");
    const lista = filterDocumentosRojos(documentos, "responsable", micaela.drilldownKey!);
    console.log("Documentos en modal:", lista.length);
    for (const d of lista) {
      console.log(`  - [${d.tipoLabel}] ${d.caratula.slice(0, 50)} | juzgado: ${d.juzgado ?? "—"} | ${d.dias ?? "—"} d`);
    }
  } else {
    console.log("No se encontró Micaela Heinrich. Top responsables:");
    responsables.slice(0, 5).forEach((r) =>
      console.log(`  ${r.label}: ${r.value} ${r.breakdown ? formatRojosBreakdown(r.breakdown) : ""}`)
    );
  }

  console.log(`\nTotal documentos rojos en universo: ${documentos.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
