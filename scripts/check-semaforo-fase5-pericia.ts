/**
 * GATE FASE 5 — colorPericia: enero excluido también en congelados (renuncia).
 * Uso: npx tsx scripts/check-semaforo-fase5-pericia.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  colorPericia,
  daysBetween,
  daysSince,
  getFechaBasePericia,
  isPericiaRenunciado,
} from "../lib/semaforo";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

type Item = {
  id: string;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  fecha_ultima_carga?: string | null;
  observaciones?: string | null;
  semaforo_congelado?: boolean | null;
  fecha_semaforo_congelado?: string | null;
};

/** Cálculo legacy (calendario simple, sin excluir enero) para renunciados congelados. */
function diasCongeladoLegacyCalendario(inicio: string, fin: string): number {
  const finD = new Date(fin);
  const inicioD = new Date(inicio);
  return Math.max(0, Math.floor((finD.getTime() - inicioD.getTime()) / (1000 * 60 * 60 * 24)));
}

function cruzaEnero(inicioIso: string, finIso: string): boolean {
  const start = new Date(inicioIso);
  const end = new Date(finIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return false;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  while (cur <= endDay) {
    if (cur.getMonth() === 0) return true;
    cur.setDate(cur.getDate() + 1);
  }
  return false;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Requerido: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  let items: Item[] = [];
  const { data, error } = await supabase
    .from("expedientes")
    .select(
      "id, numero_expediente, fecha_ultima_modificacion, fecha_ultima_carga, observaciones, semaforo_congelado, fecha_semaforo_congelado"
    )
    .eq("estado", "ABIERTO");

  if (error) {
    const { data: data2, error: err2 } = await supabase
      .from("expedientes")
      .select("id, numero_expediente, fecha_ultima_modificacion, observaciones, semaforo_congelado, fecha_semaforo_congelado")
      .eq("estado", "ABIERTO");
    if (err2) throw err2;
    items = ((data2 ?? []) as Item[]).map((r) => ({ ...r, fecha_ultima_carga: null }));
  } else {
    items = (data ?? []) as Item[];
  }
  const periciaItems = items.filter((e) => {
    const base = getFechaBasePericia(e);
    return base != null;
  });

  const renunciados = periciaItems.filter((e) => isPericiaRenunciado(e));
  const activos = periciaItems.filter((e) => !isPericiaRenunciado(e));

  const renCruzaEnero = renunciados.filter((e) => {
    const base = getFechaBasePericia(e)!;
    const fin = e.fecha_semaforo_congelado;
    return fin && cruzaEnero(base, fin);
  });

  const actCruzaEnero = activos.filter((e) => {
    const base = getFechaBasePericia(e)!;
    return cruzaEnero(base, new Date().toISOString());
  });

  console.log("═══ FASE 5 — colorPericia (20/50 + enero en congelados) ═══");
  console.log("Expedientes con fecha base:", periciaItems.length);
  console.log("Renunciados/congelados:", renunciados.length);
  console.log("Renunciados que cruzan enero:", renCruzaEnero.length);
  console.log("Activos que cruzan enero (hasta hoy):", actCruzaEnero.length);

  console.log("\n── Renunciado con enero: legacy vs colorPericia ──");
  let renEjemplo = renCruzaEnero[0];
  if (!renEjemplo && renunciados[0]) renEjemplo = renunciados[0];
  if (renEjemplo) {
    const base = getFechaBasePericia(renEjemplo)!;
    const fin = renEjemplo.fecha_semaforo_congelado!;
    const legacy = diasCongeladoLegacyCalendario(base, fin);
    const nuevo = colorPericia(renEjemplo);
    console.log(`ID: ${renEjemplo.id.slice(0, 8)}… | ${renEjemplo.numero_expediente ?? "—"}`);
    console.log(`  fechaBase → congelado: ${base.slice(0, 10)} → ${fin.slice(0, 10)}`);
    console.log(`  cruza enero: ${cruzaEnero(base, fin)}`);
    console.log(`  días LEGACY (calendario): ${legacy}`);
    console.log(`  días colorPericia (daysBetween): ${nuevo.dias}`);
    console.log(`  color: ${nuevo.color} | renunciado: ${nuevo.renunciado}`);
    if (cruzaEnero(base, fin) && legacy !== nuevo.dias) {
      console.log(`  ✓ enero corregido (${legacy} → ${nuevo.dias})`);
    }
  } else {
    console.log("(sin renunciados en BD — gate parcial)");
  }

  console.log("\n── Activo con enero: daysSince (activo) ──");
  let actEjemplo = actCruzaEnero[0];
  if (!actEjemplo && activos[0]) actEjemplo = activos[0];
  if (actEjemplo) {
    const base = getFechaBasePericia(actEjemplo)!;
    const resolved = colorPericia(actEjemplo);
    console.log(`ID: ${actEjemplo.id.slice(0, 8)}… | ${actEjemplo.numero_expediente ?? "—"}`);
    console.log(`  fechaBase: ${base.slice(0, 10)}`);
    console.log(`  cruza enero hasta hoy: ${cruzaEnero(base, new Date().toISOString())}`);
    console.log(`  días daysSince: ${daysSince(base)}`);
    console.log(`  días colorPericia: ${resolved.dias}`);
    console.log(`  color: ${resolved.color}`);
    const ok = daysSince(base) === resolved.dias;
    console.log(`  activo coherente: ${ok ? "✓" : "✗"}`);
  }

  console.log("\n── Verificación daysBetween en renunciado ──");
  let gateOk = true;
  if (renEjemplo?.fecha_semaforo_congelado) {
    const base = getFechaBasePericia(renEjemplo)!;
    const fin = renEjemplo.fecha_semaforo_congelado;
    const expected = daysBetween(base, fin);
    const actual = colorPericia(renEjemplo).dias;
    const usaDaysBetween = actual === expected;
    console.log(`daysBetween esperado: ${expected} | colorPericia: ${actual} | ${usaDaysBetween ? "✓" : "✗"}`);
    if (!usaDaysBetween) gateOk = false;
    if (cruzaEnero(base, fin)) {
      const legacy = diasCongeladoLegacyCalendario(base, fin);
      if (legacy <= (actual ?? 0)) {
        console.log("⚠ legacy debería ser >= nuevo cuando cruza enero");
      } else {
        console.log(`✓ legacy (${legacy}) > nuevo (${actual}) — enero descontado`);
      }
    }
  }

  if (actEjemplo) {
    const base = getFechaBasePericia(actEjemplo)!;
    if (daysSince(base) !== colorPericia(actEjemplo).dias) gateOk = false;
  }

  if (renunciados.length === 0 && activos.length === 0) {
    console.log("\n── Casos sintéticos (BD sin datos de pericia) ──");
    const synthRen = {
      fecha_ultima_modificacion: "2025-12-01T00:00:00.000Z",
      fecha_semaforo_congelado: "2026-02-28T00:00:00.000Z",
      observaciones: "RENUNCIADO: prueba gate",
      semaforo_congelado: true,
    };
    const synthAct = {
      fecha_ultima_modificacion: "2025-12-01T00:00:00.000Z",
    };
    const baseR = getFechaBasePericia(synthRen)!;
    const finR = synthRen.fecha_semaforo_congelado!;
    const legacyR = diasCongeladoLegacyCalendario(baseR, finR);
    const nuevoR = colorPericia(synthRen);
    const baseA = getFechaBasePericia(synthAct)!;
    const nuevoA = colorPericia(synthAct);
    console.log(`Renunciado sintético (cruza enero): legacy=${legacyR} → daysBetween=${nuevoR.dias} | color=${nuevoR.color}`);
    console.log(`Activo sintético: daysSince=${daysSince(baseA)} | colorPericia=${nuevoA.dias} | color=${nuevoA.color}`);
    if (nuevoR.dias === null || nuevoR.dias >= legacyR) gateOk = false;
    if (nuevoR.color !== "ROJO" || !nuevoR.renunciado) gateOk = false;
    if (daysSince(baseA) !== nuevoA.dias) gateOk = false;
  }

  console.log("\n═══ RESUMEN GATE 5 ═══");
  console.log(gateOk ? "GATE OK" : "GATE CON FALLOS");
  if (!gateOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
