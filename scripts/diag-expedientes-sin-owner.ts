/**
 * PASO 1 — Diagnóstico expedientes rojos sin owner (solo lectura).
 * Uso: npx tsx scripts/diag-expedientes-sin-owner.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  buildAssignPlan,
  buildCedulaOwnerIndex,
  buildDiagReport,
  buildExpedientesUnificados,
  buildRojosSinOwnerExpedientes,
  computeMonitoreoPJNStats,
  esMonitoreoPJN,
  esMonitoreoPJN,
  loadPjnFavoritosForOwner,
  type CedulaForOwnerSignal,
  type ExpedienteForOwner,
} from "../lib/expediente-owner-resolve";
import { buildResponsableRojosChart } from "../lib/semaforo-dashboard-rojos";
import { colorCedulaOficio } from "../lib/semaforo";
import { isExpedientePjnMergeEnabled } from "../lib/expediente-pjn-merge";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

function pad(n: number, w = 5): string {
  return String(n).padStart(w);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Requerido: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);

  const [
    { data: cedulasRaw, error: cErr },
    { data: expsRaw, error: eErr },
    { data: userJuzgadosRows },
  ] = await Promise.all([
    supabase
      .from("cedulas")
      .select("id, owner_user_id, ocr_exp_nro, tipo_documento, estado")
      .neq("estado", "CERRADA"),
    supabase
      .from("expedientes")
      .select(
        "id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado"
      )
      .eq("estado", "ABIERTO"),
    supabase.from("user_juzgados").select("user_id, juzgado"),
  ]);

  if (cErr) throw cErr;
  if (eErr) throw eErr;

  const cedulas = (cedulasRaw ?? []) as CedulaForOwnerSignal[];
  const allExpedientes = (expsRaw ?? []) as ExpedienteForOwner[];
  const localIds = new Set(allExpedientes.map((e) => e.id));
  const pjnFavoritos = await loadPjnFavoritosForOwner(supabase);
  const expedientesUnificados = buildExpedientesUnificados(allExpedientes, pjnFavoritos);
  const cedulaIndex = buildCedulaOwnerIndex(cedulas);
  const rojosSinOwner = buildRojosSinOwnerExpedientes(expedientesUnificados);
  const rojosTrabajoSinOwner = rojosSinOwner.filter(
    (e) => !esMonitoreoPJN(e, localIds, cedulaIndex)
  );
  const report = buildDiagReport(
    rojosTrabajoSinOwner,
    localIds,
    cedulaIndex,
    userJuzgadosRows ?? []
  );

  const sinOwnerLocal = allExpedientes.filter(
    (e) => !e.owner_user_id?.trim()
  ).length;

  console.log("═══ GATE 1 — Diagnóstico expedientes rojos sin responsable ═══");
  console.log("Merge PJN:", isExpedientePjnMergeEnabled() ? "activo" : "desactivado");
  console.log("Expedientes locales ABIERTO:", allExpedientes.length);
  console.log("  └ sin owner_user_id:", sinOwnerLocal);
  console.log("Favoritos PJN activos:", pjnFavoritos.length);
  console.log("Expedientes unificados:", expedientesUnificados.length);
  console.log("ROJOS sin owner (monitoreo PJN incl.):", rojosSinOwner.length);
  console.log("ROJOS sin owner — solo trabajo del estudio:", rojosTrabajoSinOwner.length);
  console.log("Cédulas/oficios con match key indexadas:", cedulaIndex.size);

  // Cross-check con chart responsables
  const documentosRojos = [
    ...cedulas
      .map((c) => ({ c, ...colorCedulaOficio(c) }))
      .filter((x) => x.color === "ROJO" && x.c.owner_user_id?.trim())
      .map((x) => ({
        id: x.c.id,
        tipo: (x.c.tipo_documento === "OFICIO" ? "OFICIO" : "CEDULA") as "OFICIO" | "CEDULA",
        tipoLabel: x.c.tipo_documento === "OFICIO" ? "Oficio" : "Cédula",
        caratula: "",
        juzgado: null,
        juzgadoKey: "",
        dias: x.dias,
        ownerUserId: x.c.owner_user_id!.trim(),
        ownerName: x.c.owner_user_id!.trim(),
        href: "/app",
      })),
    ...rojosTrabajoSinOwner.map((e) => ({
      id: e.id,
      tipo: "EXPEDIENTE" as const,
      tipoLabel: "Expediente",
      caratula: e.caratula ?? "",
      juzgado: e.juzgado,
      juzgadoKey: "",
      dias: null,
      ownerUserId: null as string | null,
      ownerName: "Sin responsable",
      href: "/superadmin/mis-juzgados",
    })),
  ];
  const sinRespChart = buildResponsableRojosChart(documentosRojos).find(
    (c) => c.drilldownKey === "__sin_responsable__"
  );
  if (sinRespChart) {
    console.log(
      `Chart responsables "Sin responsable": ${sinRespChart.value} (${sinRespChart.breakdown?.exp ?? "?"} exp · ${sinRespChart.breakdown?.ced ?? "?"} céd · ${sinRespChart.breakdown?.of ?? "?"} of)`
    );
  }

  console.log("\n| Cat | Descripción | Conteo |");
  console.log("|-----|-------------|--------|");
  console.log(
    `| A | Local + céd/of mismo caso con owner | ${pad(report.counts.A)} | (único: ${report.aUnique}, conflicto→C: ${report.aConflict}) |`
  );
  console.log(
    `| B | Local, sin céd/of owner, juzgado → 1 user | ${pad(report.counts.B)} |`
  );
  console.log(`| C | Local ambiguo (manual) | ${pad(report.counts.C)} |`);
  console.log(
    `| D | Solo PJN + céd/of owner mismo caso | ${pad(report.counts.D)} | (único: ${report.dUnique}, conflicto→C: ${report.dConflict}) |`
  );
  console.log(`| E | Solo PJN sin respaldo (monitoreo) | ${pad(report.counts.E)} |`);

  const sum =
    report.counts.A +
    report.counts.B +
    report.counts.C +
    report.counts.D +
    report.counts.E;
  console.log(`| **TOTAL** | | **${sum}** |`);

  const plan = buildAssignPlan(report);
  const wouldAssign = plan.filter(
    (p) => p.action === "assign_owner" || p.action === "create_local_and_assign"
  ).length;
  const monitoreo = computeMonitoreoPJNStats(
    expedientesUnificados,
    localIds,
    cedulaIndex
  );
  const rojosTrabajoSinOwnerCount = report.items.filter(
    (i) => i.categoria !== "E" && !i.isPjnOnly
  ).length;

  console.log("\n─── Vista previa asignación (reglas A/D, B apagado) ───");
  console.log(`Asignaría automáticamente (A+D): ${wouldAssign}`);
  console.log(`Manual (C): ${plan.filter((p) => p.action === "manual").length}`);
  console.log(`Monitoreo PJN (E): ${plan.filter((p) => p.action === "monitoreo").length}`);
  console.log(`Monitoreo PJN (fuera de métricas gerenciales): ${monitoreo.total} (${monitoreo.rojos} rojos)`);
  console.log(`Sin responsable — solo trabajo local real: ${rojosTrabajoSinOwnerCount}`);

  console.log("\n─── Pregunta negocio: user_juzgados = responsabilidad real? ───");
  console.log(
    `Si activás USAR_JUZGADO_COMO_OWNER, ${report.counts.B} expedientes locales más pasarían a asignación automática (categoría B).`
  );
  console.log(
    "Si user_juzgados es solo control de acceso (varios abogados ven el mismo juzgado), NO activar B."
  );

  if (process.argv.includes("--verbose")) {
    console.log("\n─── Detalle por categoría ───");
    for (const cat of ["A", "B", "C", "D", "E"] as const) {
      const subset = report.items.filter((i) => i.categoria === cat).slice(0, 5);
      if (!subset.length) continue;
      console.log(`\n[${cat}] primeros ${subset.length}:`);
      for (const i of subset) {
        console.log(
          `  ${i.id.slice(0, 12)}… | ${i.numeroExpediente ?? "—"} | juzgado users: ${i.juzgadoUserIds.length} | signal: ${i.proposedSignal ?? "—"}`
        );
      }
    }
  }

  if (sum !== report.totalRojosSinOwner) {
    console.error("\n✗ ERROR: categorías no suman el total");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
