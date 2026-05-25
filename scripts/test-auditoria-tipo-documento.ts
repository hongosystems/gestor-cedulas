/**
 * Tests mínimos del clasificador y del extractor de PDFs.
 *
 * Ejecutar:
 *   npx tsx scripts/test-auditoria-tipo-documento.ts
 *
 * Verifica:
 *   1. Texto típico de OFICIO                        → OFICIO
 *   2. Texto típico de CEDULA                        → CEDULA
 *   3. Texto ambiguo / vacío                         → INDETERMINADO
 *   4. PDF sin texto parseable / extracción fallida  → INDETERMINADO, ok:true,
 *      razón "No se pudo extraer texto localmente del PDF"
 *   5. dry_run=true en /run no escribe DB            → cubierto por revisión de código (ver run/route.ts)
 *   6. clasificacion_pdf inválida en INSERT          → CHECK constraint rechaza (ver migration)
 */

import {
  RAZON_EXTRACCION_FALLIDA,
  clasificacionExtraccionFallida,
  clasificarTextoPdf,
  clasificarTextoPdfDesdeString,
  extraerTextoPdfLocal,
  type ClasificacionResultado,
} from "../lib/auditoria-tipo-documento-pdf";

type TestCase = {
  name: string;
  input: string | { paginas: string[] };
  expected: ClasificacionResultado["clasificacion"];
  expectMinConfianza?: number;
};

const TEST_CASES: TestCase[] = [
  // 1) OFICIO clarísimo
  {
    name: "OFICIO: librese oficio al Banco de la Nación",
    input:
      "OFICIO. Líbrese oficio al Sr. Director del Banco de la Nación Argentina a fin de que informe...",
    expected: "OFICIO",
    expectMinConfianza: 0.4,
  },
  // OFICIO institucional
  {
    name: "OFICIO: ANSES + AFIP institucional",
    input:
      "Buenos Aires, 15 de marzo de 2025. Al Señor Director de ANSES y al Director de AFIP. Por el presente oficio se solicita...",
    expected: "OFICIO",
    expectMinConfianza: 0.3,
  },
  // 2) CEDULA clarísima
  {
    name: "CEDULA: cédula de notificación con oficial notificador",
    input:
      "CÉDULA DE NOTIFICACIÓN. Zona Nro. 1. Se notifica al destinatario en su domicilio constituido. Oficial Notificador interviniente: J. Pérez.",
    expected: "CEDULA",
    expectMinConfianza: 0.5,
  },
  // CEDULA sin la frase "CÉDULA DE NOTIFICACIÓN"
  {
    name: "CEDULA: notificación + zona + dependencia",
    input:
      "Notificación. Domicilio constituido. Dependencia: Juzgado Nacional. Se notifica al destinatario el art. 135 CPCC.",
    expected: "CEDULA",
    expectMinConfianza: 0.2,
  },
  // 3) AMBIGUO
  {
    name: "INDETERMINADO: PDF en blanco",
    input: "",
    expected: "INDETERMINADO",
  },
  {
    name: "INDETERMINADO: texto sin patrones identificables",
    input:
      "Buenos Aires, 22 de mayo de 2025. Por la presente se hace saber que el expediente N° 12345/2024 fue archivado en la fecha consignada.",
    expected: "INDETERMINADO",
  },
  {
    name: "INDETERMINADO: empate exacto (CEDULA + OFICIO con mismo peso)",
    // "OFICIO" peso 3 vs "CEDULA" peso 3 → empate
    input: "El oficio y la cédula deben firmarse antes del lunes próximo.",
    expected: "INDETERMINADO",
  },
  // OFICIO con mención breve a "cédula"
  {
    name: "OFICIO: oficio con mención casual a cédula",
    // OFICIO peso 3 + LÍBRESE OFICIO peso 4 = 7
    // CEDULA peso 3 = 3
    // diff = 4 → confianza 0.44
    input:
      "OFICIO. Líbrese oficio al Hospital. Acompañar copia de la cédula del titular del DNI.",
    expected: "OFICIO",
    expectMinConfianza: 0.4,
  },
];

function check(actual: ClasificacionResultado, tc: TestCase): { ok: boolean; reason: string } {
  if (actual.clasificacion !== tc.expected) {
    return {
      ok: false,
      reason: `esperado ${tc.expected} → recibido ${actual.clasificacion} (confianza ${actual.confianza})`,
    };
  }
  if (tc.expectMinConfianza != null && actual.confianza < tc.expectMinConfianza) {
    return {
      ok: false,
      reason: `clasificación OK pero confianza ${actual.confianza} < mínima esperada ${tc.expectMinConfianza}`,
    };
  }
  return { ok: true, reason: "" };
}

// =============================================================================
// Tests de extracción local (escenarios donde extraerTextoPdfLocal no debe
// lanzar y, si falla, debe entregar { ok: false, error } controlado).
// =============================================================================

type ExtraccionCase = {
  name: string;
  buffer: Buffer;
  /**
   * "ok"   ⇒ devuelve ok:true (incluso si pages = 0).
   * "fail" ⇒ devuelve ok:false (sin throw) y clasificacionExtraccionFallida()
   *          produce INDETERMINADO + razón de extracción.
   */
  expectOutcome: "ok" | "fail";
};

const EXTRACTION_CASES: ExtraccionCase[] = [
  {
    name: "Buffer vacío → extracción fallida controlada",
    buffer: Buffer.alloc(0),
    expectOutcome: "fail",
  },
  {
    name: "Bytes basura (no es PDF) → extracción fallida controlada",
    buffer: Buffer.from("esto no es un pdf — solo texto plano para forzar fallo"),
    expectOutcome: "fail",
  },
  {
    name: "PDF mínimo válido sin páginas → ok con 0 páginas (clasif INDETERMINADO)",
    buffer: Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\nxref\n0 3\n0000000000 65535 f\n0000000009 00000 n\n0000000056 00000 n\ntrailer<</Size 3/Root 1 0 R>>\nstartxref\n107\n%%EOF\n"
    ),
    expectOutcome: "ok",
  },
];

async function ejecutarTestsExtraccion(): Promise<{ pass: number; fail: number; total: number }> {
  let pass = 0;
  let fail = 0;

  console.log("");
  console.log("[tipo-doc-audit][test] casos de extracción");

  for (const tc of EXTRACTION_CASES) {
    let outcome: "ok" | "fail";
    let extra = "";
    try {
      const r = await extraerTextoPdfLocal(tc.buffer, 4);
      if (r.ok) {
        outcome = "ok";
        extra = `pages=${r.paginas.length}`;
      } else {
        outcome = "fail";
        extra = `err=${r.error.slice(0, 80)}`;
      }
    } catch (e: unknown) {
      // El contrato es no lanzar. Si algo lanza, falla el test.
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → extraerTextoPdfLocal LANZÓ (no debería): ${msg}`);
      fail++;
      continue;
    }

    if (outcome === tc.expectOutcome) {
      pass++;
      console.log(`  ✔ ${tc.name} (${extra})`);
    } else {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → esperaba ${tc.expectOutcome}, obtuve ${outcome} (${extra})`);
    }
  }

  return { pass, fail, total: EXTRACTION_CASES.length };
}

function testClasificacionExtraccionFallida(): { pass: number; fail: number; total: number } {
  console.log("");
  console.log("[tipo-doc-audit][test] casos de clasificación post-extracción fallida");
  let pass = 0;
  let fail = 0;

  const cases: Array<{ name: string; detalle?: string; expectPatronIncluye: string }> = [
    {
      name: "extracción fallida sin detalle",
      detalle: undefined,
      expectPatronIncluye: RAZON_EXTRACCION_FALLIDA,
    },
    {
      name: "extracción fallida con detalle técnico",
      detalle: "DOMMatrix is not defined",
      expectPatronIncluye: "DOMMatrix",
    },
  ];

  for (const tc of cases) {
    const r = clasificacionExtraccionFallida(tc.detalle);
    const razon = r.razones[0];
    const okClasif = r.clasificacion === "INDETERMINADO";
    const okConf = r.confianza === 0;
    const okRazones = r.razones.length === 1;
    const okClasificacionNula = razon?.clasificacion === null;
    const okPesoCero = razon?.peso === 0;
    const okPatron = razon?.patron.includes(tc.expectPatronIncluye) ?? false;

    if (okClasif && okConf && okRazones && okClasificacionNula && okPesoCero && okPatron) {
      pass++;
      console.log(`  ✔ ${tc.name}`);
    } else {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → clasif=${r.clasificacion} conf=${r.confianza} razones=${r.razones.length}`);
      console.log(`     → razon=${JSON.stringify(razon)}`);
    }
  }

  return { pass, fail, total: cases.length };
}

async function run(): Promise<void> {
  let pass = 0;
  let fail = 0;
  console.log("[tipo-doc-audit][test] inicio");
  console.log("[tipo-doc-audit][test] casos de clasificación de texto");

  for (const tc of TEST_CASES) {
    const resultado =
      typeof tc.input === "string"
        ? clasificarTextoPdfDesdeString(tc.input)
        : clasificarTextoPdf(tc.input);
    const verdict = check(resultado, tc);
    if (verdict.ok) {
      pass++;
      console.log(`  ✔ ${tc.name}`);
    } else {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → ${verdict.reason}`);
      console.log(`     → razones: ${resultado.razones.map((r) => `${r.patron}(${r.peso})`).join(", ") || "(ninguna)"}`);
    }
  }

  const extr = await ejecutarTestsExtraccion();
  const fallida = testClasificacionExtraccionFallida();

  pass += extr.pass + fallida.pass;
  fail += extr.fail + fallida.fail;
  const total = TEST_CASES.length + extr.total + fallida.total;

  console.log("");
  console.log(`[tipo-doc-audit][test] ${pass} OK · ${fail} fallidas · ${total} total`);

  // Casos estructurales (no automatizables sin DB).
  console.log("");
  console.log("[tipo-doc-audit][test] notas estructurales:");
  console.log("  • dry_run=true en /run: la rama dryRun retorna sin INSERT (ver run/route.ts).");
  console.log("  • Si la extracción falla, /run reporta ok:true + INDETERMINADO (ver run/route.ts).");
  console.log("  • Solo se reporta ok:false ante fallo de descarga (download del Storage).");
  console.log(
    "  • CHECK clasificacion_pdf IN ('CEDULA','OFICIO','INDETERMINADO'): cualquier INSERT con valor distinto es rechazado por Postgres."
  );

  if (fail > 0) {
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error("[tipo-doc-audit][test] runner crasheó:", e);
  process.exitCode = 1;
});
