/**
 * Contrasta expedientes del Excel de Francisco con detección Prueba/Pericia en BD.
 * Uso: npx tsx scripts/diag-francisco-prueba-pericia.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";
import {
  buildOrdenesDeteccionIndex,
  incluirEnDeteccion,
  ordenesDeteccionRefsFromApi,
} from "../lib/prueba-pericia-deteccion";
import { tienePruebaPericia } from "../lib/prueba-pericia-detect";

dotenv.config({ path: join(process.cwd(), ".env.local") });

const mainUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const pjnUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
const pjnKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;
const FRANCISCO_ID = "35a96627-1c5c-49be-b79a-81d8f9ba8396";

if (!mainUrl || !mainKey) {
  console.error("Faltan credenciales main supabase");
  process.exit(1);
}

const main = createClient(mainUrl, mainKey);
const pjn = pjnUrl && pjnKey ? createClient(pjnUrl, pjnKey) : null;

type ExpRow = { expediente: string; numero: number; anio: number; estado: string };
const exps: ExpRow[] = JSON.parse(readFileSync(join(process.cwd(), "scripts/_francisco_exps.json"), "utf8"));

function normalizarJuzgado(j: string | null | undefined) {
  return String(j || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function juzgadosCoinciden(j1: string, j2: string) {
  const a = normalizarJuzgado(j1);
  const b = normalizarJuzgado(j2);
  if (a === b) return true;
  const n1 = a.match(/N[°º]?\s*(\d+)/i)?.[1];
  const n2 = b.match(/N[°º]?\s*(\d+)/i)?.[1];
  return Boolean(n1 && n2 && n1 === n2 && a.includes("JUZGADO") && b.includes("JUZGADO"));
}

function buildKey(numero: number, anio: number, jurisdiccion = "CIV") {
  return `${jurisdiccion} ${String(numero).padStart(6, "0")}/${anio}`;
}

function extractDetalle(mov: Record<string, unknown>): string {
  let detalle = "";
  if (mov.Detalle) detalle = String(mov.Detalle).toUpperCase();
  else if (Array.isArray(mov.cols)) {
    for (const col of mov.cols) {
      const m = String(col).match(/Detalle:\s*(.+)/i);
      if (m) {
        detalle = m[1].toUpperCase();
        break;
      }
    }
    if (!detalle) detalle = mov.cols.map(String).join(" ").toUpperCase();
  }
  return detalle;
}

function findRelevantMov(movs: unknown): string | null {
  const arr = Array.isArray(movs) ? movs : [movs];
  for (const mov of arr) {
    if (typeof mov !== "object" || !mov) continue;
    const detalle = extractDetalle(mov as Record<string, unknown>);
    if (!detalle) continue;
    if (
      /AUTOS?\s+A\s+PRUEBA|ABRESE\s+A\s+PRUEBA|SE\s+ABRE\s+LA\s+CAUSA\s+A\s+PRUEBA|PROV[EÉ]ASE\s+PRUEBA|SE\s+PROVEE\s+LA\s+PRUEBA/i.test(
        detalle
      )
    ) {
      return `[apertura prueba] ${detalle.slice(0, 140)}`;
    }
    if (/PERICI|PERITO|PRUEBA\s+PERICI/i.test(detalle) && !tienePruebaPericia([mov])) {
      return `[sin match patrón] ${detalle.slice(0, 140)}`;
    }
  }
  return null;
}

async function findFav(numero: number, anio: number) {
  for (const v of [String(numero).padStart(6, "0"), String(numero)]) {
    const { data } = await main
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, juzgado, caratula, movimientos")
      .eq("jurisdiccion", "CIV")
      .eq("numero", v)
      .eq("anio", anio)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

async function mainFn() {
  const { data: juzgados } = await main.from("user_juzgados").select("juzgado").eq("user_id", FRANCISCO_ID);
  const jAsignados = (juzgados || []).map((j) => normalizarJuzgado(j.juzgado));

  const { data: ordenesData } = await main
    .from("ordenes_medicas")
    .select("id, case_ref, expediente_id, expedientes(numero_expediente, caratula, juzgado)");
  const ordenesIndex = buildOrdenesDeteccionIndex(ordenesDeteccionRefsFromApi(ordenesData ?? []));
  console.log(`Francisco juzgados asignados (${jAsignados.length})`);

  type Result = {
    key: string;
    expediente: string;
    estadoExcel: string;
    enFavoritos: boolean;
    juzgado: string | null;
    tieneMovimientos: boolean;
    fuenteMovimientos: string | null;
    detecta: boolean;
    juzgadoOk: boolean | null;
    muestraDetalle: string | null;
  };

  const results = {
    detecta: [] as Result[],
    noDetecta: [] as Result[],
    sinFavorito: [] as Result[],
    sinMovimientos: [] as Result[],
    juzgadoNoAsignado: [] as Result[],
  };

  for (const exp of exps) {
    const key = buildKey(exp.numero, exp.anio);

    const fav = await findFav(exp.numero, exp.anio);
    let movimientos = fav?.movimientos;
    let fuente: string | null = fav?.movimientos ? "pjn_favoritos" : null;

    if (!movimientos && pjn) {
      const { data: caseRows } = await pjn.from("cases").select("key, movimientos").eq("key", key).limit(1);
      if (caseRows?.[0]?.movimientos) {
        movimientos = caseRows[0].movimientos;
        fuente = "cases";
      }
    }

    const juzgadoOk =
      jAsignados.length && fav?.juzgado
        ? jAsignados.some((j) => juzgadosCoinciden(fav.juzgado, j))
        : fav?.juzgado
          ? null
          : null;

    const numeroExpediente = fav
      ? `${fav.jurisdiccion} ${fav.numero}/${fav.anio}`
      : key;
    const detecta = incluirEnDeteccion(
      {
        id: fav ? `pjn_${fav.id}` : `case:${key}`,
        numero_expediente: numeroExpediente,
        movimientos,
      },
      ordenesIndex
    );

    const row: Result = {
      key,
      expediente: exp.expediente,
      estadoExcel: exp.estado,
      enFavoritos: Boolean(fav),
      juzgado: fav?.juzgado ?? null,
      tieneMovimientos: Boolean(movimientos),
      fuenteMovimientos: fuente,
      detecta,
      juzgadoOk,
      muestraDetalle: movimientos ? findRelevantMov(movimientos) : null,
    };

    if (!fav) results.sinFavorito.push(row);
    else if (!row.detecta) results.noDetecta.push(row);
    else results.detecta.push(row);
  }

  console.log("\n=== RESUMEN ===");
  console.log(`Total Excel: ${exps.length}`);
  console.log(`Detecta Prueba/Pericia: ${results.detecta.length}`);
  console.log(`NO detecta (tiene movs): ${results.noDetecta.length}`);
  console.log(`Sin favorito PJN: ${results.sinFavorito.length}`);
  console.log(`Sin movimientos: ${results.sinMovimientos.length}`);
  console.log(`Detecta pero juzgado no asignado: ${results.juzgadoNoAsignado.length}`);

  const show = (title: string, arr: Result[]) => {
    if (!arr.length) return;
    console.log(`\n=== ${title} (${arr.length}) ===`);
    for (const r of arr) {
      console.log(`\n${r.key}`);
      console.log(`  Excel: ${r.expediente}`);
      if (r.estadoExcel) console.log(`  Nota Excel: ${r.estadoExcel}`);
      console.log(
        `  Favorito: ${r.enFavoritos ? "sí" : "NO"} | Movs: ${r.tieneMovimientos ? r.fuenteMovimientos : "NO"} | Detecta: ${r.detecta}`
      );
      if (r.juzgado) console.log(`  Juzgado: ${r.juzgado} | En mis juzgados: ${r.juzgadoOk}`);
      if (r.muestraDetalle) console.log(`  Detalle: ${r.muestraDetalle}`);
    }
  };

  show("NO DETECTA (con movimientos)", results.noDetecta);
  show("SIN FAVORITO PJN", results.sinFavorito);
  show("SIN MOVIMIENTOS", results.sinMovimientos);
  show("DETECTA PERO JUZGADO NO ASIGNADO", results.juzgadoNoAsignado);
}

mainFn().catch((e) => {
  console.error(e);
  process.exit(1);
});
