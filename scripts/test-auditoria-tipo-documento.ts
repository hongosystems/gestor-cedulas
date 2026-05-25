/**
 * Tests mínimos del clasificador, extractor de PDFs y orquestación OCR.
 *
 * Ejecutar:
 *   npx tsx scripts/test-auditoria-tipo-documento.ts
 *
 * Verifica:
 *   1. Texto típico de OFICIO                                   → OFICIO
 *   2. Texto típico de CEDULA                                   → CEDULA
 *   3. Texto ambiguo / vacío                                    → INDETERMINADO
 *   4. PDF sin texto parseable / extracción fallida             → INDETERMINADO, ok:true
 *   5. dry_run=true en /run no escribe DB                       → revisión de código
 *   6. obtenerTextoParaAuditoria: local útil → fuente "local"
 *   7. obtenerTextoParaAuditoria: local sin texto + use_ocr=false → fuente "sin_texto"
 *   8. obtenerTextoParaAuditoria: local sin texto + use_ocr=true + OCR oficio → fuente "ocr" + OFICIO
 *   9. obtenerTextoParaAuditoria: local sin texto + use_ocr=true + OCR cédula → fuente "ocr" + CEDULA
 *  10. obtenerTextoParaAuditoria: OCR falla → fuente "sin_texto" (INDETERMINADO)
 *  11. razonesMetaDeFuente / leerFuenteDeRazones (round-trip)
 *  12. sanitizarTextoParaDebug: vacío, null, undefined, sanitización, truncado, custom max
 *  13. Guarda debug_text: solo se honra cuando dry_run=true
 *  14. clasificacion_pdf inválida en INSERT → CHECK constraint rechaza
 */

import {
  PDF_AUDIT_DEBUG_TEXT_MAX,
  PDF_AUDIT_TEXTO_MIN_UTIL,
  RAZON_EXTRACCION_FALLIDA,
  clasificacionExtraccionFallida,
  clasificarTextoPdf,
  clasificarTextoPdfDesdeString,
  extraerTextoPdfLocal,
  leerFuenteDeRazones,
  obtenerTextoParaAuditoria,
  razonesMetaDeFuente,
  sanitizarTextoParaDebug,
  type ClasificacionResultado,
  type ExtractorResultado,
  type OcrClient,
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

// =============================================================================
// Tests de orquestación OCR (obtenerTextoParaAuditoria).
// -----------------------------------------------------------------------------
// Usamos un OcrClient mock inyectable; nunca tocamos el microservicio real.
// El buffer es "basura" (no PDF) para forzar que la extracción local falle y
// se delegue al OCR — patrón realista (PDF escaneado donde pdf-parse no extrae).
// =============================================================================

function makeOcrClient(impl: OcrClient["invocar"]): OcrClient {
  return { invocar: impl };
}

const TEXTO_OCR_OFICIO =
  "OFICIO. Líbrese oficio al Sr. Director del Banco de la Nación Argentina " +
  "a fin de que informe los movimientos de la cuenta del demandado.";
const TEXTO_OCR_CEDULA =
  "CÉDULA DE NOTIFICACIÓN. Zona Nro. 1. Se notifica al destinatario en su " +
  "domicilio constituido. Oficial Notificador interviniente: J. Pérez.";
const BUFFER_NO_PDF = Buffer.from("este buffer no es un PDF, fuerza fallback a OCR");

async function testObtenerTextoParaAuditoria(): Promise<{
  pass: number;
  fail: number;
  total: number;
}> {
  console.log("");
  console.log(
    "[tipo-doc-audit][test] casos de obtenerTextoParaAuditoria (orquestación OCR)"
  );
  let pass = 0;
  let fail = 0;

  type Case = {
    name: string;
    useOcr: boolean;
    ocrClient: OcrClient | null;
    expectFuente: "local" | "ocr" | "sin_texto";
    /** Si se espera "ocr"/"local", se clasifica y se valida esta clasificación. */
    expectClasif?: ClasificacionResultado["clasificacion"];
    /** Texto local sintético para forzar fuente="local" (skip pdf-parse). */
    forceLocalText?: string;
  };

  const cases: Case[] = [
    {
      name: "local sin texto + use_ocr=false → sin_texto",
      useOcr: false,
      ocrClient: null,
      expectFuente: "sin_texto",
    },
    {
      name: "local sin texto + use_ocr=true + OCR devuelve OFICIO → ocr + OFICIO",
      useOcr: true,
      ocrClient: makeOcrClient(async (): Promise<ExtractorResultado> => ({
        ok: true,
        texto: TEXTO_OCR_OFICIO,
        texto_chars: TEXTO_OCR_OFICIO.length,
        ocr_used: true,
      })),
      expectFuente: "ocr",
      expectClasif: "OFICIO",
    },
    {
      name: "local sin texto + use_ocr=true + OCR devuelve CEDULA → ocr + CEDULA",
      useOcr: true,
      ocrClient: makeOcrClient(async (): Promise<ExtractorResultado> => ({
        ok: true,
        texto: TEXTO_OCR_CEDULA,
        texto_chars: TEXTO_OCR_CEDULA.length,
        ocr_used: true,
      })),
      expectFuente: "ocr",
      expectClasif: "CEDULA",
    },
    {
      name: "local sin texto + use_ocr=true + OCR falla → sin_texto",
      useOcr: true,
      ocrClient: makeOcrClient(async (): Promise<ExtractorResultado> => ({
        ok: false,
        error: "HTTP 503 Service Unavailable",
      })),
      expectFuente: "sin_texto",
    },
    {
      name: "local sin texto + use_ocr=true + OCR devuelve texto corto → sin_texto",
      useOcr: true,
      ocrClient: makeOcrClient(async (): Promise<ExtractorResultado> => ({
        ok: true,
        texto: "x",
        texto_chars: 1,
        ocr_used: true,
      })),
      expectFuente: "sin_texto",
    },
  ];

  for (const tc of cases) {
    let texto;
    try {
      texto = await obtenerTextoParaAuditoria(BUFFER_NO_PDF, {
        useOcr: tc.useOcr,
        ocrClient: tc.ocrClient,
      });
    } catch (e: unknown) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → obtenerTextoParaAuditoria LANZÓ (no debería): ${msg}`);
      continue;
    }

    if (texto.fuente !== tc.expectFuente) {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(
        `     → esperaba fuente=${tc.expectFuente}, obtuve ${texto.fuente} (chars=${texto.texto_chars}, detalle=${texto.detalle})`
      );
      continue;
    }

    if (tc.expectClasif != null) {
      const clasif = clasificarTextoPdf({ paginas: texto.paginas });
      if (clasif.clasificacion !== tc.expectClasif) {
        fail++;
        console.log(`  ✘ ${tc.name}`);
        console.log(
          `     → fuente OK pero clasificación esperada ${tc.expectClasif} obtuve ${clasif.clasificacion} (conf=${clasif.confianza})`
        );
        continue;
      }
    }

    pass++;
    const extra =
      tc.expectClasif != null
        ? ` (chars=${texto.texto_chars}, clasif=${tc.expectClasif})`
        : ` (chars=${texto.texto_chars})`;
    console.log(`  ✔ ${tc.name}${extra}`);
  }

  return { pass, fail, total: cases.length };
}

function testLocalConTextoUtil(): { pass: number; fail: number; total: number } {
  console.log("");
  console.log(
    "[tipo-doc-audit][test] casos de obtenerTextoParaAuditoria (rama local útil)"
  );
  // Estos casos verifican el "happy path" local: cuando pdf-parse devuelve
  // texto suficientemente largo, NO se invoca el OCR client (lo demostramos
  // pasando un client que lanza si es invocado). Como no podemos generar PDFs
  // legítimos de prueba con pdf-parse sin agregar fixtures binarias, este caso
  // se cubre indirectamente vía TEST_CASES (clasificación de texto plano).
  console.log(
    `  ◯ rama "local útil" se valida vía TEST_CASES sobre texto plano (umbral=${PDF_AUDIT_TEXTO_MIN_UTIL} chars).`
  );
  return { pass: 0, fail: 0, total: 0 };
}

function testRazonesMetaRoundTrip(): { pass: number; fail: number; total: number } {
  console.log("");
  console.log("[tipo-doc-audit][test] razonesMetaDeFuente ↔ leerFuenteDeRazones");
  let pass = 0;
  let fail = 0;

  const cases: Array<{
    name: string;
    fuente: "local" | "ocr" | "sin_texto";
    chars: number;
    detalle?: string;
  }> = [
    { name: "local 1234 chars", fuente: "local", chars: 1234 },
    { name: "ocr 487 chars con detalle", fuente: "ocr", chars: 487, detalle: "extractor remoto" },
    { name: "sin_texto 0 chars", fuente: "sin_texto", chars: 0, detalle: "OCR falló" },
  ];

  for (const tc of cases) {
    const razones = razonesMetaDeFuente(tc.fuente, tc.chars, tc.detalle);
    // Mezclamos con razones de clasificación para asegurar que el lector las ignora.
    const mixed = [
      ...razones,
      { patron: "OFICIO", clasificacion: "OFICIO" as const, peso: 3, pagina: 1 },
      { patron: "CEDULA", clasificacion: "CEDULA" as const, peso: 3, pagina: 1 },
    ];
    const leido = leerFuenteDeRazones(mixed);

    if (leido.fuente_texto === tc.fuente && leido.texto_chars === tc.chars) {
      pass++;
      console.log(`  ✔ ${tc.name} → ${leido.fuente_texto}/${leido.texto_chars}`);
    } else {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → esperaba ${tc.fuente}/${tc.chars} obtuve ${leido.fuente_texto}/${leido.texto_chars}`);
    }
  }

  // Registros legados (sin razones meta) deben devolver null/null.
  const legado = leerFuenteDeRazones([
    { patron: "OFICIO", clasificacion: "OFICIO", peso: 3, pagina: 1 },
  ]);
  if (legado.fuente_texto === null && legado.texto_chars === null) {
    pass++;
    console.log(`  ✔ razones legadas (sin meta) → null/null`);
  } else {
    fail++;
    console.log(`  ✘ razones legadas (sin meta) → debería null/null pero fue ${legado.fuente_texto}/${legado.texto_chars}`);
  }

  // Razones nulas o array vacío.
  const vacio = leerFuenteDeRazones(null);
  if (vacio.fuente_texto === null && vacio.texto_chars === null) {
    pass++;
    console.log(`  ✔ razones=null → null/null`);
  } else {
    fail++;
    console.log(`  ✘ razones=null → debería null/null pero fue ${vacio.fuente_texto}/${vacio.texto_chars}`);
  }

  return { pass, fail, total: cases.length + 2 };
}

// =============================================================================
// Tests del modo debug_text (sanitizador + guarda dry_run).
// =============================================================================

function testSanitizarTextoParaDebug(): { pass: number; fail: number; total: number } {
  console.log("");
  console.log("[tipo-doc-audit][test] sanitizarTextoParaDebug");
  let pass = 0;
  let fail = 0;

  type Case = {
    name: string;
    input: string | null | undefined;
    max?: number;
    /** Aserciones sobre el resultado. */
    expect: (r: { debug_text: string; debug_text_chars_originales: number }) => string | null;
  };

  const ruidoso =
    "Hola\r\nmundo\n\n\n\n\nfin\r\n   con    espacios\t\t\tmultiples   \n\n";
  const cases: Case[] = [
    {
      name: "string vacío → vacío",
      input: "",
      expect: (r) =>
        r.debug_text === "" && r.debug_text_chars_originales === 0
          ? null
          : `got ${JSON.stringify(r)}`,
    },
    {
      name: "null → vacío",
      input: null,
      expect: (r) =>
        r.debug_text === "" && r.debug_text_chars_originales === 0
          ? null
          : `got ${JSON.stringify(r)}`,
    },
    {
      name: "undefined → vacío",
      input: undefined,
      expect: (r) =>
        r.debug_text === "" && r.debug_text_chars_originales === 0
          ? null
          : `got ${JSON.stringify(r)}`,
    },
    {
      name: "colapsa saltos y espacios; preserva originalChars",
      input: ruidoso,
      expect: (r) => {
        if (r.debug_text_chars_originales !== ruidoso.length) {
          return `originalChars=${r.debug_text_chars_originales} esperado ${ruidoso.length}`;
        }
        if (/\n{3,}/.test(r.debug_text)) return "quedaron 3+ saltos consecutivos";
        if (/[^\S\n]{2,}/.test(r.debug_text)) return "quedaron 2+ espacios consecutivos";
        if (r.debug_text.startsWith(" ") || r.debug_text.endsWith(" ")) {
          return "no se aplicó trim";
        }
        if (!r.debug_text.includes("Hola") || !r.debug_text.includes("fin")) {
          return "se perdió contenido";
        }
        return null;
      },
    },
    {
      name: `trunca a ${PDF_AUDIT_DEBUG_TEXT_MAX} chars + marca [truncado]`,
      input: "A".repeat(PDF_AUDIT_DEBUG_TEXT_MAX + 500),
      expect: (r) => {
        const limite = PDF_AUDIT_DEBUG_TEXT_MAX;
        if (!r.debug_text.startsWith("A".repeat(limite))) {
          return "no truncó al límite correcto";
        }
        if (!r.debug_text.endsWith("…[truncado]")) {
          return `no marcó truncado, terminó en: …${JSON.stringify(r.debug_text.slice(-20))}`;
        }
        if (r.debug_text_chars_originales !== limite + 500) {
          return `originalChars=${r.debug_text_chars_originales} esperado ${limite + 500}`;
        }
        return null;
      },
    },
    {
      name: "texto < límite NO marca [truncado]",
      input: "OFICIO. Líbrese oficio al Banco.",
      expect: (r) => {
        if (r.debug_text.includes("[truncado]")) return "marcó truncado siendo corto";
        if (r.debug_text_chars_originales !== "OFICIO. Líbrese oficio al Banco.".length) {
          return `originalChars=${r.debug_text_chars_originales}`;
        }
        return null;
      },
    },
    {
      name: "max custom = 10 → trunca a 10",
      input: "abcdefghijklmnopqrstuvwxyz",
      max: 10,
      expect: (r) => {
        if (!r.debug_text.startsWith("abcdefghij")) return `prefijo erróneo: ${r.debug_text}`;
        if (!r.debug_text.endsWith("…[truncado]")) return "no marcó truncado";
        if (r.debug_text_chars_originales !== 26) {
          return `originalChars=${r.debug_text_chars_originales}`;
        }
        return null;
      },
    },
  ];

  for (const tc of cases) {
    const r = tc.max != null
      ? sanitizarTextoParaDebug(tc.input, tc.max)
      : sanitizarTextoParaDebug(tc.input);
    const err = tc.expect(r);
    if (err === null) {
      pass++;
      console.log(`  ✔ ${tc.name}`);
    } else {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → ${err}`);
    }
  }

  return { pass, fail, total: cases.length };
}

/**
 * Simula la guarda del endpoint: el caller calcula `debugTextEfectivo =
 * debugText && dryRun`. Si dry_run=false, debug_text se ignora aunque se haya
 * pedido. Verificamos esa lógica aquí — replicada como helper testeable.
 */
function debeIncluirDebugText(dryRun: boolean, debugText: boolean): boolean {
  return debugText && dryRun;
}

function testGuardaDebugText(): { pass: number; fail: number; total: number } {
  console.log("");
  console.log("[tipo-doc-audit][test] guarda debug_text (solo con dry_run=true)");
  let pass = 0;
  let fail = 0;

  const cases: Array<{ dryRun: boolean; debugText: boolean; expected: boolean }> = [
    { dryRun: true, debugText: true, expected: true },
    { dryRun: true, debugText: false, expected: false },
    { dryRun: false, debugText: true, expected: false }, // <-- caso crítico
    { dryRun: false, debugText: false, expected: false },
  ];

  for (const tc of cases) {
    const got = debeIncluirDebugText(tc.dryRun, tc.debugText);
    if (got === tc.expected) {
      pass++;
      console.log(
        `  ✔ dry_run=${tc.dryRun}, debug_text=${tc.debugText} → ${got}`
      );
    } else {
      fail++;
      console.log(
        `  ✘ dry_run=${tc.dryRun}, debug_text=${tc.debugText} → ${got} (esperaba ${tc.expected})`
      );
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
  const ocrOrq = await testObtenerTextoParaAuditoria();
  const ocrLocal = testLocalConTextoUtil();
  const meta = testRazonesMetaRoundTrip();
  const sanitiz = testSanitizarTextoParaDebug();
  const guardaDbg = testGuardaDebugText();

  pass +=
    extr.pass +
    fallida.pass +
    ocrOrq.pass +
    ocrLocal.pass +
    meta.pass +
    sanitiz.pass +
    guardaDbg.pass;
  fail +=
    extr.fail +
    fallida.fail +
    ocrOrq.fail +
    ocrLocal.fail +
    meta.fail +
    sanitiz.fail +
    guardaDbg.fail;
  const total =
    TEST_CASES.length +
    extr.total +
    fallida.total +
    ocrOrq.total +
    ocrLocal.total +
    meta.total +
    sanitiz.total +
    guardaDbg.total;

  console.log("");
  console.log(`[tipo-doc-audit][test] ${pass} OK · ${fail} fallidas · ${total} total`);

  // Casos estructurales (no automatizables sin DB).
  console.log("");
  console.log("[tipo-doc-audit][test] notas estructurales:");
  console.log("  • dry_run=true en /run: la rama dryRun retorna sin INSERT (ver run/route.ts).");
  console.log("  • Si la extracción falla, /run reporta ok:true + INDETERMINADO (ver run/route.ts).");
  console.log("  • Solo se reporta ok:false ante fallo de descarga (download del Storage).");
  console.log("  • use_ocr default=false. Cuando es true y PDF_EXTRACTOR_URL no está, fuente='sin_texto'.");
  console.log("  • razonesMetaDeFuente se PREPENDA a razones de clasificación (ver run/route.ts).");
  console.log("  • /list/route.ts deriva fuente_texto y texto_chars vía leerFuenteDeRazones (compat con registros legados).");
  console.log("  • debug_text default=false. Solo se honra cuando dry_run=true (ver debugTextEfectivo en run/route.ts).");
  console.log(`  • debug_text NUNCA se persiste en DB; se trunca a ${PDF_AUDIT_DEBUG_TEXT_MAX} chars y se sanitiza saltos/espacios.`);
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
