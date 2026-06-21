/**
 * Test de integración HIF — requiere dev server (npm run dev).
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const BASE = process.env.HIF_TEST_BASE_URL ?? "http://localhost:3000";
const API_KEY = process.env.HIF_INTEGRATION_API_KEY;
const WRONG_KEY = "0000000000000000000000000000000000000000000000000000000000000000";

if (!API_KEY) {
  console.error("❌ Falta HIF_INTEGRATION_API_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log(`✅ ${label}`);
}

function fail(label, detail) {
  failed++;
  console.log(`❌ ${label}`);
  if (detail) console.log(`   ${detail}`);
}

async function fetchHif(path, options = {}) {
  const headers = options.headers ?? {};
  return fetch(`${BASE}${path}`, { ...options, headers });
}

async function findExpedienteConMovimientos() {
  const { data } = await supabase
    .from("pjn_favoritos")
    .select("id, caratula, movimientos")
    .not("movimientos", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  let best = data?.[0];
  let bestCount = 0;
  for (const row of data ?? []) {
    const count = Array.isArray(row.movimientos) ? row.movimientos.length : 0;
    if (count > bestCount) {
      best = row;
      bestCount = count;
    }
  }
  return best;
}

async function testPartesUnit() {
  const { parsePartesFromCaratula } = await import("../lib/integrations/hif-mappers.ts");

  console.log("=== Test unitario parsePartesFromCaratula ===\n");

  const caso1 = parsePartesFromCaratula("FERNANDEZ, SERGIO C/ RIERA, MARIA S/ DAÑOS");
  if (
    caso1.length === 2 &&
    caso1[0].rol === "Actor" &&
    caso1[0].nombre.includes("FERNANDEZ") &&
    caso1[1].rol === "Demandado"
  ) {
    ok('partes caso 1: "X c/ Y"');
  } else {
    fail("partes caso 1", JSON.stringify(caso1));
  }

  const caso2 = parsePartesFromCaratula(
    "INCIDENTE Nº 1 - ACTOR: SEIVA, ALEJANDRO DEMANDADO: FERNANDEZ, MARIANO S/ MEDIDAS"
  );
  if (
    caso2.length === 2 &&
    caso2[0].nombre.includes("SEIVA") &&
    caso2[1].nombre.includes("FERNANDEZ")
  ) {
    ok('partes caso 2: incidente ACTOR/DEMANDADO');
  } else {
    fail("partes caso 2", JSON.stringify(caso2));
  }

  const caso3 = parsePartesFromCaratula("Algo sin formato reconocible");
  if (caso3.length === 0) {
    ok("partes caso 3: sin formato → []");
  } else {
    fail("partes caso 3", JSON.stringify(caso3));
  }

  console.log("");
}

async function run() {
  console.log("=== Test integración HIF ===\n");
  console.log(`Base URL: ${BASE}\n`);

  await testPartesUnit();

  // --- Auth ---
  {
    const res = await fetchHif("/api/integrations/hif/expedientes/search?q=abc");
    if (res.status === 401) ok("401 sin header X-API-Key");
    else fail("401 sin header", `status=${res.status}`);
  }

  {
    const res = await fetchHif("/api/integrations/hif/expedientes/search?q=abc", {
      headers: { "X-API-Key": WRONG_KEY },
    });
    if (res.status === 401) ok("401 con key incorrecta");
    else fail("401 key incorrecta", `status=${res.status}`);
  }

  // --- Search validation ---
  {
    const res = await fetchHif("/api/integrations/hif/expedientes/search?q=ab", {
      headers: { "X-API-Key": API_KEY },
    });
    if (res.status === 400) ok("400 con q < 3 chars");
    else fail("400 q corto", `status=${res.status}`);
  }

  // --- Search 200 ---
  let searchBody;
  let sampleId;
  {
    const res = await fetchHif("/api/integrations/hif/expedientes/search?q=guaita", {
      headers: { "X-API-Key": API_KEY },
    });
    searchBody = await res.json();
    if (res.status === 200 && Array.isArray(searchBody)) {
      ok("200 search con q=guaita (array en raíz)");
      if (searchBody.length > 0) {
        const item = searchBody[0];
        sampleId = item.id;
        if (
          item.id &&
          item.caratula != null &&
          item.numero &&
          item.fuero &&
          item.ano &&
          Array.isArray(item.partes)
        ) {
          ok("search schema del primer resultado");
        } else {
          fail("search schema", JSON.stringify(item));
        }
      } else {
        console.log("⚠️  search q=guaita sin resultados, probando q=fernandez");
        const res2 = await fetchHif("/api/integrations/hif/expedientes/search?q=fernandez", {
          headers: { "X-API-Key": API_KEY },
        });
        searchBody = await res2.json();
        if (res2.status === 200 && searchBody.length > 0) {
          sampleId = searchBody[0].id;
          ok("200 search fallback q=fernandez");
        } else {
          fail("search sin resultados útiles");
        }
      }
    } else {
      fail("200 search", `status=${res.status} body=${JSON.stringify(searchBody)}`);
    }
  }

  // --- 404 ---
  {
    const fakeId = "00000000-0000-0000-0000-000000000099";
    const res = await fetchHif(`/api/integrations/hif/expedientes/${fakeId}`, {
      headers: { "X-API-Key": API_KEY },
    });
    const body = await res.json();
    if (res.status === 404 && body.error === "Expediente no encontrado") {
      ok("404 expediente inexistente");
    } else {
      fail("404", `status=${res.status}`);
    }
  }

  const expediente = await findExpedienteConMovimientos();
  if (!expediente?.id) {
    fail("No se encontró expediente con movimientos en DB");
    process.exit(1);
  }
  const testId = sampleId ?? expediente.id;
  console.log(`\nExpediente de prueba: ${testId}`);
  console.log(`Carátula: ${(expediente.caratula ?? "").slice(0, 60)}…`);
  console.log(`Movimientos raw: ${Array.isArray(expediente.movimientos) ? expediente.movimientos.length : 0}\n`);

  // --- Detalle ---
  let detalleBody;
  {
    const res = await fetchHif(`/api/integrations/hif/expedientes/${testId}`, {
      headers: { "X-API-Key": API_KEY },
    });
    detalleBody = await res.json();
    if (res.status === 200 && detalleBody.id === testId) {
      ok("200 detalle");
      const required = [
        "caratula",
        "numero",
        "fuero",
        "ano",
        "juzgado",
        "secretaria",
        "partes",
        "estado",
        "ultimaActuacion",
        "ultimaActuacionFecha",
      ];
      const missing = required.filter((k) => !(k in detalleBody));
      if (missing.length === 0 && detalleBody.estado === "En trámite") {
        ok("detalle schema completo");
      } else {
        fail("detalle schema", `missing=${missing.join(",")}`);
      }
      if (Array.isArray(detalleBody.partes) && detalleBody.partes.every((p) => p.rol && p.nombre)) {
        ok("detalle partes con rol+nombre");
      } else {
        fail("detalle partes formato");
      }
    } else {
      fail("200 detalle", `status=${res.status}`);
    }
  }

  // --- Movimientos ---
  let movimientosBody;
  {
    const res = await fetchHif(`/api/integrations/hif/expedientes/${testId}/movimientos`, {
      headers: { "X-API-Key": API_KEY },
    });
    movimientosBody = await res.json();
    if (res.status === 200 && Array.isArray(movimientosBody.movimientos)) {
      ok("200 movimientos");
      const movs = movimientosBody.movimientos;
      if (movs.length >= 3) {
        ok(`movimientos parseados >= 3 (${movs.length})`);
      } else {
        fail(`movimientos >= 3`, `solo ${movs.length}`);
      }
      const first = movs[0];
      if (
        first?.id?.length === 16 &&
        first.expedienteId === testId &&
        first.fecha &&
        first.tipo &&
        first.texto != null &&
        !("raw" in first)
      ) {
        ok("movimiento schema (sin raw)");
      } else {
        fail("movimiento schema", JSON.stringify(first));
      }
      // orden DESC
      if (movs.length >= 2 && movs[0].fecha >= movs[1].fecha) {
        ok("movimientos ordenados por fecha DESC");
      } else if (movs.length < 2) {
        ok("movimientos orden (solo 1)");
      } else {
        fail("orden DESC");
      }
    } else {
      fail("200 movimientos", `status=${res.status}`);
    }
  }

  // --- Novedades ---
  {
    const res = await fetchHif(`/api/integrations/hif/expedientes/${testId}/novedades`, {
      headers: { "X-API-Key": API_KEY },
    });
    const body = await res.json();
    if (res.status === 200 && Array.isArray(body.novedades)) {
      ok("200 novedades");
      const nov = body.novedades[0];
      if (
        nov &&
        nov.id &&
        nov.titulo === nov.tipo &&
        nov.raw &&
        typeof nov.raw === "object"
      ) {
        ok("novedad schema con raw");
      } else if (body.novedades.length === 0) {
        ok("novedades vacías (ok)");
      } else {
        fail("novedad schema", JSON.stringify(nov));
      }
    } else {
      fail("200 novedades", `status=${res.status}`);
    }
  }

  // --- Partes regex samples (vía endpoint detalle) ---
  console.log("\n=== 5 ejemplos partes parseadas (endpoint detalle) ===\n");
  const searchForPartes = await fetchHif(
    "/api/integrations/hif/expedientes/search?q=fernandez",
    { headers: { "X-API-Key": API_KEY } }
  );
  const partesCandidates = await searchForPartes.json();
  const partesSamples = [];
  for (const item of (Array.isArray(partesCandidates) ? partesCandidates : []).slice(0, 15)) {
    const dRes = await fetchHif(`/api/integrations/hif/expedientes/${item.id}`, {
      headers: { "X-API-Key": API_KEY },
    });
    if (!dRes.ok) continue;
    const det = await dRes.json();
    partesSamples.push({ caratula: det.caratula, partes: det.partes });
    if (partesSamples.length >= 5) break;
  }
  for (const [i, s] of partesSamples.entries()) {
    console.log(`${i + 1}. Carátula: ${(s.caratula ?? "").slice(0, 80)}…`);
    console.log(`   Partes: ${JSON.stringify(s.partes)}\n`);
  }

  // --- Respuestas reales para reporte ---
  console.log("\n=== RESPUESTA REAL search (q=guaita) ===\n");
  const searchRes = await fetchHif("/api/integrations/hif/expedientes/search?q=guaita", {
    headers: { "X-API-Key": API_KEY },
  });
  console.log(JSON.stringify(await searchRes.json(), null, 2));

  console.log("\n=== RESPUESTA REAL detalle ===\n");
  console.log(JSON.stringify(detalleBody, null, 2));

  console.log("\n=== RESPUESTA REAL movimientos (primeros 3) ===\n");
  console.log(
    JSON.stringify(
      { movimientos: (movimientosBody?.movimientos ?? []).slice(0, 3) },
      null,
      2
    )
  );

  console.log(`\n=== Resumen: ${passed} OK, ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
