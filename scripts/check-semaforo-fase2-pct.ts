/**
 * GATE 2 — verifica que pctRojas + pctAmarillas + pctVerdes ≈ 100% sobre universo semáforo.
 * Uso: npx tsx scripts/check-semaforo-fase2-pct.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { colorCedulaOficio, colorPorDias, daysSince, UMBRALES } from "../lib/semaforo";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

function semaforoExpediente(fecha: string | null) {
  if (!fecha) return "VERDE" as const;
  return colorPorDias(daysSince(fecha), UMBRALES.expediente);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Faltan variables Supabase");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const [{ data: cedulas }, { data: expedientes }] = await Promise.all([
    supabase
      .from("cedulas")
      .select("owner_user_id, fecha_carga, pjn_cargado_at, admin_cedulas_completada_at")
      .neq("estado", "CERRADA"),
    supabase
      .from("expedientes")
      .select("owner_user_id, fecha_ultima_modificacion")
      .neq("estado", "CERRADA"),
  ]);

  let totalRojas = 0;
  let totalAmarillas = 0;
  let totalVerdes = 0;
  let totalAbiertas = 0;

  for (const c of cedulas ?? []) {
    if (!c.owner_user_id?.trim()) continue;
    totalAbiertas++;
    const color = colorCedulaOficio(c).color;
    if (color === "ROJO") totalRojas++;
    else if (color === "AMARILLO") totalAmarillas++;
    else totalVerdes++;
  }

  for (const e of expedientes ?? []) {
    if (!e.owner_user_id?.trim() || !e.fecha_ultima_modificacion) continue;
    const color = semaforoExpediente(e.fecha_ultima_modificacion);
    if (color === "ROJO") totalRojas++;
    else if (color === "AMARILLO") totalAmarillas++;
    else totalVerdes++;
  }

  const totalUniversoSemaforo = totalRojas + totalAmarillas + totalVerdes;
  const pctRojas = totalUniversoSemaforo > 0 ? (totalRojas / totalUniversoSemaforo) * 100 : 0;
  const pctAmarillas = totalUniversoSemaforo > 0 ? (totalAmarillas / totalUniversoSemaforo) * 100 : 0;
  const pctVerdes = totalUniversoSemaforo > 0 ? (totalVerdes / totalUniversoSemaforo) * 100 : 0;
  const suma = pctRojas + pctAmarillas + pctVerdes;

  console.log("\n=== GATE 2 — Porcentajes (aprox. BD, sin merge PJN en expedientes) ===");
  console.log("Documentos abiertos (cédulas+oficios con owner):", totalAbiertas);
  console.log("Universo semáforo (conteo por color):", totalUniversoSemaforo);
  console.log(`  ROJO: ${totalRojas} → ${pctRojas.toFixed(1)}%`);
  console.log(`  AMARILLO: ${totalAmarillas} → ${pctAmarillas.toFixed(1)}%`);
  console.log(`  VERDE: ${totalVerdes} → ${pctVerdes.toFixed(1)}%`);
  console.log(`Suma: ${suma.toFixed(1)}% ${Math.abs(suma - 100) <= 1 ? "✓" : "✗"}`);

  // Denominador viejo (bug)
  const bugR = totalAbiertas > 0 ? (totalRojas / totalAbiertas) * 100 : 0;
  const bugA = totalAbiertas > 0 ? (totalAmarillas / totalAbiertas) * 100 : 0;
  const bugV = totalAbiertas > 0 ? (totalVerdes / totalAbiertas) * 100 : 0;
  console.log("\nAntes (bug — denominador totalAbiertas):", {
    rojo: bugR.toFixed(1) + "%",
    amarillo: bugA.toFixed(1) + "%",
    verde: bugV.toFixed(1) + "%",
    suma: (bugR + bugA + bugV).toFixed(1) + "%",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
