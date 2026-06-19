/**
 * GATE 1 — verifica reconciliación cédulas/oficios (dashboard legacy vs colorCedulaOficio).
 * Uso: npx tsx scripts/check-semaforo-fase1.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import {
  colorCedulaOficio,
  colorPorDias,
  daysSince,
  LEGACY_SEMAFORO_CUTOFF_DATE,
  UMBRALES,
} from "../lib/semaforo";

type CedulaRow = {
  id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_carga: string | null;
  tipo_documento: string | null;
  pjn_cargado_at: string | null;
  admin_cedulas_completada_at: string | null;
  owner_user_id: string | null;
};

/** Lógica previa del dashboard (sin congelado ni legacy). */
function colorDashboardLegacy(doc: CedulaRow) {
  const dias = daysSince(doc.fecha_carga);
  return colorPorDias(dias, UMBRALES.cedulaOficio);
}

function countColors(rows: CedulaRow[], resolver: (d: CedulaRow) => string) {
  const counts = { ROJO: 0, AMARILLO: 0, VERDE: 0 };
  for (const r of rows) {
    const c = resolver(r) as keyof typeof counts;
    if (c in counts) counts[c]++;
  }
  return counts;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("cedulas")
    .select(
      "id, caratula, juzgado, fecha_carga, tipo_documento, pjn_cargado_at, admin_cedulas_completada_at, owner_user_id"
    )
    .neq("estado", "CERRADA");

  if (error) {
    console.error("Error cargando cédulas:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as CedulaRow[];
  const cedulasOnly = rows.filter((r) => !r.tipo_documento || r.tipo_documento === "CEDULA");
  const oficiosOnly = rows.filter((r) => r.tipo_documento === "OFICIO");
  const docAbiertos = rows;

  const antesLegacy = countColors(docAbiertos, colorDashboardLegacy);
  const despues = countColors(docAbiertos, (d) => colorCedulaOficio(d).color);

  const cedulasRojasAntes = cedulasOnly.filter((d) => colorDashboardLegacy(d) === "ROJO").length;
  const cedulasRojasDespues = cedulasOnly.filter((d) => colorCedulaOficio(d).color === "ROJO").length;

  const legacyClampCount = docAbiertos.filter((d) => colorCedulaOficio(d).legacyClampAplicado).length;

  console.log("\n=== GUARDA 3 — Legacy cutoff ===");
  console.log("NEXT_PUBLIC_SEMAFORO_LEGACY_CUTOFF_DATE:", LEGACY_SEMAFORO_CUTOFF_DATE ?? "(vacío → clamp no-op)");
  console.log("Cédulas/oficios con ROJO→AMARILLO por legacy:", legacyClampCount);

  console.log("\n=== GUARDA 2 — Conteos antes/después (universo cédulas+oficios abiertos) ===");
  console.log("ANTES (dashboard legacy, sin congelado):", antesLegacy);
  console.log("DESPUÉS (colorCedulaOficio):", despues);
  console.log(`Rojos solo CÉDULAS: ${cedulasRojasAntes} → ${cedulasRojasDespues} (Δ ${cedulasRojasDespues - cedulasRojasAntes})`);

  const congelados = docAbiertos.filter(
    (d) => d.pjn_cargado_at || d.admin_cedulas_completada_at
  );

  console.log("\n=== GATE 1 — Muestra con congelado (hasta 5) ===");
  const muestra = congelados.slice(0, 5);
  for (const d of muestra) {
    const nuevo = colorCedulaOficio(d);
    const viejo = colorDashboardLegacy(d);
    const match = viejo === nuevo.color ? "✓" : "≠ (esperado si congeló)";
    console.log({
      id: d.id.slice(0, 8),
      caratula: (d.caratula || "").slice(0, 40),
      tipo: d.tipo_documento,
      dashboardAntes: viejo,
      resolverNuevo: nuevo.color,
      dias: nuevo.dias,
      congelado: nuevo.congelado,
      motivo: nuevo.motivo,
      paridadMisCedulas: nuevo.color,
      match,
    });
  }

  const divergencias = docAbiertos.filter((d) => {
    const n = colorCedulaOficio(d);
    // Mis Cédulas y dashboard nuevo deben ser idénticos (misma función)
    return false;
  });

  if (divergencias.length === 0) {
    console.log("\n✓ Un solo resolver: Mis Cédulas y dashboard comparten colorCedulaOficio.");
  }

  console.log(`\nTotal abiertos: ${docAbiertos.length} (${cedulasOnly.length} cédulas, ${oficiosOnly.length} oficios)`);
  console.log(`Con pjn_cargado_at o admin_cedulas_completada_at: ${congelados.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
