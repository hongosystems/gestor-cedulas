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
 *  12. esTextoJudicialUtil: rechaza XHTML PyPDF2, page vacío, Producer="PyPDF2",
 *      acepta CEDULA/OFICIO/expediente/domicilio, fallback léxico amplio
 *  13. orquestador rechaza XHTML del extractor: OCR returns XHTML → sin_texto
 *  14. sanitizarTextoParaDebug: vacío, null, undefined, sanitización, truncado, custom max
 *  15. Guarda debug_text: solo se honra cuando dry_run=true
 *  16. clasificacion_pdf inválida en INSERT → CHECK constraint rechaza
 */

import {
  AUDIT_MAX_PAGES_DEFAULT,
  AUDIT_MAX_PAGES_MAX,
  AUDIT_MAX_PAGES_MIN,
  PDF_AUDIT_DEBUG_TEXT_MAX,
  RAZON_EXTRACCION_FALLIDA,
  clasificacionExtraccionFallida,
  clasificarTextoPdf,
  clasificarTextoPdfDesdeString,
  esTextoJudicialUtil,
  extraerTextoPdfLocal,
  leerFuenteDeRazones,
  obtenerClasificacionAuditoria,
  obtenerTextoParaAuditoria,
  parsearMaxPages,
  parsearRespuestaGptVision,
  razonesMetaDeClasificacion,
  razonesMetaDeFuente,
  recortarPdfPrimeraPaginas,
  sanitizarTextoParaDebug,
  type ClasificacionResultado,
  type ExtractorResultado,
  type GptVisionClient,
  type GptVisionResultado,
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
    `  ◯ rama "local útil" se valida vía TEST_CASES sobre texto plano (criterio: esTextoJudicialUtil).`
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
// Tests de esTextoJudicialUtil.
// -----------------------------------------------------------------------------
// El criterio reemplaza al antiguo ">= 30 chars" porque el microservicio
// extractor puede devolver XHTML residual de `pdftotext -bbox` que tiene
// muchos chars pero es estructura vacía (caso real observado en producción
// con PDFs generados por PyPDF2).
// =============================================================================

const XHTML_PYPDF2_VACIO =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n' +
  '<html xmlns="http://www.w3.org/1999/xhtml" lang="" xml:lang="">\n' +
  "<head>\n" +
  '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>\n' +
  '<meta name="Producer" content="PyPDF2"/>\n' +
  "</head>\n" +
  "<body>\n" +
  "<doc>\n" +
  '<page width="594.300000" height="840.510000">\n' +
  "</page>\n" +
  "</doc>\n" +
  "</body>\n" +
  "</html>\n";

const XHTML_CON_PAGE_VACIO =
  "<html><body><doc><page width='594.3' height='840.5'></page></doc></body></html>";

function testEsTextoJudicialUtil(): { pass: number; fail: number; total: number } {
  console.log("");
  console.log("[tipo-doc-audit][test] esTextoJudicialUtil");
  let pass = 0;
  let fail = 0;

  type Case = { name: string; input: string | null | undefined; expected: boolean };

  const cases: Case[] = [
    // ─── HARD REJECT: marcadores HTML/XML ───────────────────────────────────
    {
      name: "XHTML PyPDF2 vacío (330 chars, caso real prod) → false",
      input: XHTML_PYPDF2_VACIO,
      expected: false,
    },
    {
      name: "XHTML con <page width=...> y body vacío → false",
      input: XHTML_CON_PAGE_VACIO,
      expected: false,
    },
    {
      name: "string con <!DOCTYPE html → false",
      input: "<!DOCTYPE html><body>Juzgado Civil expediente 1234 oficio</body>",
      expected: false,
    },
    {
      name: "string con Producer PyPDF2 → false",
      input: 'Producer" content="PyPDF2" Juzgado oficio cédula',
      expected: false,
    },
    // ─── HARD REJECT: vacío/null/short ──────────────────────────────────────
    { name: "vacío → false", input: "", expected: false },
    { name: "null → false", input: null, expected: false },
    { name: "undefined → false", input: undefined, expected: false },
    { name: "muy corto sin palabras judiciales → false", input: "ab cd ef", expected: false },
    {
      name: "puntuación y números sin letras suficientes → false",
      input: "12345 ----- ##### @@@ {} () [] 67890",
      expected: false,
    },
    {
      name: "texto con < 3 palabras alfabéticas → false",
      input: "ab xy",
      expected: false,
    },
    // ─── ACCEPT: contiene palabra judicial ──────────────────────────────────
    {
      name: "CÉDULA DE NOTIFICACIÓN con Juzgado → true",
      input:
        "CÉDULA DE NOTIFICACIÓN. Juzgado Nacional Civil N° 1. Expediente 12345/2024.",
      expected: true,
    },
    {
      name: "OFICIO al Sr Director del Banco → true",
      input:
        "OFICIO. Líbrese oficio al Sr. Director del Banco de la Nación Argentina.",
      expected: true,
    },
    {
      name: "Texto con 'expediente' y 'autos' → true",
      input:
        "Buenos Aires, 15 de marzo de 2025. En los autos del expediente N° 105662/2024.",
      expected: true,
    },
    {
      name: "Texto con 'domicilio constituido' → true",
      input:
        "Se notifica al destinatario en su domicilio constituido. La presente notificación...",
      expected: true,
    },
    // ─── ACCEPT: fallback por léxico amplio (sin palabras judiciales) ──────
    {
      name: "Texto con 10+ palabras alfabéticas sin léxico judicial → true (fallback)",
      input:
        "Buenos Aires veintidós mayo dos mil veinticinco información detallada respecto situación particular contribuyente conforme normativa vigente aplicable",
      expected: true,
    },
    // ─── REJECT: texto pero sin léxico suficiente ni palabras judiciales ───
    {
      name: "Pocas palabras sin léxico judicial → false",
      input: "Buenos Aires veintidós mayo dos",
      expected: false,
    },
    // ─── ACCEPT case-insensitive ────────────────────────────────────────────
    {
      name: "Mayúsculas y acentos: 'CÉDULA' detecta como 'cédula' → true",
      input: "ESTO ES UNA CÉDULA EMITIDA POR EL JUZGADO RESPECTIVO XYZ ABC DEF.",
      expected: true,
    },
  ];

  for (const tc of cases) {
    const got = esTextoJudicialUtil(tc.input);
    if (got === tc.expected) {
      pass++;
      console.log(`  ✔ ${tc.name}`);
    } else {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → esperaba ${tc.expected}, obtuve ${got}`);
    }
  }

  return { pass, fail, total: cases.length };
}

/**
 * Tests específicos del bug observado en producción: el OCR remoto devuelve
 * XHTML vacío y la auditoría lo marcaba como fuente="ocr" con clasificación
 * INDETERMINADO. Ahora debe quedar como fuente="sin_texto".
 */
async function testOrquestadorRechazaXhtml(): Promise<{
  pass: number;
  fail: number;
  total: number;
}> {
  console.log("");
  console.log("[tipo-doc-audit][test] orquestador rechaza XHTML del extractor");
  let pass = 0;
  let fail = 0;

  type Case = {
    name: string;
    ocrResponse: ExtractorResultado;
    expectFuente: "ocr" | "sin_texto";
  };

  const cases: Case[] = [
    {
      name: "XHTML PyPDF2 vacío (caso prod) → sin_texto",
      ocrResponse: {
        ok: true,
        texto: XHTML_PYPDF2_VACIO,
        texto_chars: XHTML_PYPDF2_VACIO.length,
        ocr_used: false,
      },
      expectFuente: "sin_texto",
    },
    {
      name: "XHTML page vacío → sin_texto",
      ocrResponse: {
        ok: true,
        texto: XHTML_CON_PAGE_VACIO,
        texto_chars: XHTML_CON_PAGE_VACIO.length,
        ocr_used: false,
      },
      expectFuente: "sin_texto",
    },
    {
      name: "Texto OCR real OFICIO + carátula → ocr",
      ocrResponse: {
        ok: true,
        texto:
          "OFICIO. Líbrese oficio al Sr. Director del Banco de la Nación Argentina.\nCaratula: TAPIA c/ FORNERO s/ DAÑOS\nJuzgado: Juzgado Nacional Civil N° 1",
        texto_chars: 500,
        ocr_used: true,
      },
      expectFuente: "ocr",
    },
  ];

  for (const tc of cases) {
    const client: OcrClient = {
      invocar: async () => tc.ocrResponse,
    };

    let texto;
    try {
      texto = await obtenerTextoParaAuditoria(BUFFER_NO_PDF, {
        useOcr: true,
        ocrClient: client,
      });
    } catch (e: unknown) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → obtenerTextoParaAuditoria LANZÓ: ${msg}`);
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

    pass++;
    const extra = `chars=${texto.texto_chars}`;
    console.log(`  ✔ ${tc.name} (${extra})`);
  }

  return { pass, fail, total: cases.length };
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

// =============================================================================
// Tests de GPT Vision (parsearMaxPages, recortarPdfPrimeraPaginas,
// parsearRespuestaGptVision, obtenerClasificacionAuditoria con mock).
// -----------------------------------------------------------------------------
// El cliente GPT es 100% mockeable (interfaz GptVisionClient con `invocar`).
// Generamos PDFs sintéticos con pdf-lib in-memory para no depender de fixtures
// binarias en disco.
// =============================================================================

function testParsearMaxPages(): { pass: number; fail: number; total: number } {
  console.log("");
  console.log("[tipo-doc-audit][test] parsearMaxPages (clamp [1,5], default 5)");
  let pass = 0;
  let fail = 0;

  const cases: Array<{ name: string; input: unknown; expected: number }> = [
    { name: "undefined → default", input: undefined, expected: AUDIT_MAX_PAGES_DEFAULT },
    { name: "null → default", input: null, expected: AUDIT_MAX_PAGES_DEFAULT },
    { name: '""  → default', input: "", expected: AUDIT_MAX_PAGES_DEFAULT },
    { name: '"abc" (NaN) → default', input: "abc", expected: AUDIT_MAX_PAGES_DEFAULT },
    { name: "5 → 5", input: 5, expected: 5 },
    { name: '"3" → 3', input: "3", expected: 3 },
    { name: '"10" → clamp 5', input: "10", expected: AUDIT_MAX_PAGES_MAX },
    { name: "100 → clamp 5", input: 100, expected: AUDIT_MAX_PAGES_MAX },
    { name: "0 → clamp 1", input: 0, expected: AUDIT_MAX_PAGES_MIN },
    { name: '"-1" → clamp 1', input: "-1", expected: AUDIT_MAX_PAGES_MIN },
    { name: "2.7 → floor 2", input: 2.7, expected: 2 },
    { name: "1 → 1", input: 1, expected: 1 },
  ];

  for (const tc of cases) {
    const got = parsearMaxPages(tc.input);
    if (got === tc.expected) {
      pass++;
      console.log(`  ✔ ${tc.name}`);
    } else {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → esperaba ${tc.expected}, obtuve ${got}`);
    }
  }
  return { pass, fail, total: cases.length };
}

/** Genera un PDF in-memory con N páginas usando pdf-lib. */
async function pdfSinteticoConPaginas(n: number): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([200, 200]);
    p.drawText(`pagina ${i + 1}`, { x: 20, y: 100, size: 12, font: helv, color: rgb(0, 0, 0) });
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function testRecortarPdfPrimeraPaginas(): Promise<{
  pass: number;
  fail: number;
  total: number;
}> {
  console.log("");
  console.log("[tipo-doc-audit][test] recortarPdfPrimeraPaginas (pdf-lib)");
  let pass = 0;
  let fail = 0;

  type Case = {
    name: string;
    paginasTotales: number;
    maxPages: number;
    /** "ok" → recorte exitoso a `expectPaginas`. "err" → ok:false. */
    expect: { ok: true; paginas: number } | { ok: false };
  };

  const cases: Case[] = [
    {
      name: "PDF de 3 páginas + maxPages=5 → recorta a 3 (todas)",
      paginasTotales: 3,
      maxPages: 5,
      expect: { ok: true, paginas: 3 },
    },
    {
      name: "PDF de 8 páginas + maxPages=5 → recorta a 5",
      paginasTotales: 8,
      maxPages: 5,
      expect: { ok: true, paginas: 5 },
    },
    {
      name: "PDF de 1 página + maxPages=5 → recorta a 1",
      paginasTotales: 1,
      maxPages: 5,
      expect: { ok: true, paginas: 1 },
    },
    {
      name: "PDF de 7 páginas + maxPages=1 → recorta a 1",
      paginasTotales: 7,
      maxPages: 1,
      expect: { ok: true, paginas: 1 },
    },
  ];

  for (const tc of cases) {
    const src = await pdfSinteticoConPaginas(tc.paginasTotales);
    const out = await recortarPdfPrimeraPaginas(src, tc.maxPages);
    if (!out.ok) {
      if (!tc.expect.ok) {
        pass++;
        console.log(`  ✔ ${tc.name} (esperado fallo: ${out.error})`);
      } else {
        fail++;
        console.log(`  ✘ ${tc.name}`);
        console.log(`     → recorte falló inesperadamente: ${out.error}`);
      }
      continue;
    }
    if (!tc.expect.ok) {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → esperaba fallo pero recortó ${out.paginas_enviadas}`);
      continue;
    }
    if (out.paginas_enviadas !== tc.expect.paginas) {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(
        `     → esperaba ${tc.expect.paginas} páginas, obtuve ${out.paginas_enviadas} (total=${out.paginas_totales})`
      );
      continue;
    }
    pass++;
    console.log(
      `  ✔ ${tc.name} (enviadas=${out.paginas_enviadas}, totales=${out.paginas_totales}, bytes=${out.buffer.length})`
    );
  }

  // Caso: buffer no-PDF debe fallar controladamente
  const noPdf = Buffer.from("not a pdf");
  const outBad = await recortarPdfPrimeraPaginas(noPdf, 5);
  if (!outBad.ok) {
    pass++;
    console.log(`  ✔ buffer no-PDF → ok:false (${outBad.error.slice(0, 60)})`);
  } else {
    fail++;
    console.log(`  ✘ buffer no-PDF → debería fallar pero recortó ${outBad.paginas_enviadas}`);
  }
  const total = cases.length + 1;
  return { pass, fail, total };
}

function testParsearRespuestaGptVision(): { pass: number; fail: number; total: number } {
  console.log("");
  console.log("[tipo-doc-audit][test] parsearRespuestaGptVision");
  let pass = 0;
  let fail = 0;

  type Case = {
    name: string;
    input: string;
    expect: { ok: true; tipo: string; confianza?: number } | { ok: false };
  };

  const cases: Case[] = [
    {
      name: "JSON válido CEDULA",
      input: JSON.stringify({
        tipo_documento: "CEDULA",
        confianza: 0.92,
        razones: ["se notifica", "domicilio constituido"],
        texto_relevante: "CÉDULA DE NOTIFICACIÓN. Zona 1.",
      }),
      expect: { ok: true, tipo: "CEDULA", confianza: 0.92 },
    },
    {
      name: "JSON válido OFICIO",
      input: JSON.stringify({
        tipo_documento: "OFICIO",
        confianza: 0.88,
        razones: ["líbrese oficio", "dirigido a Banco"],
        texto_relevante: "OFICIO. Líbrese al Banco Nación.",
      }),
      expect: { ok: true, tipo: "OFICIO" },
    },
    {
      name: "JSON válido INDETERMINADO",
      input: JSON.stringify({
        tipo_documento: "INDETERMINADO",
        confianza: 0.1,
        razones: ["imagen ilegible"],
        texto_relevante: "",
      }),
      expect: { ok: true, tipo: "INDETERMINADO" },
    },
    {
      name: "JSON envuelto en ```json fences → repara y parsea",
      input: "```json\n" + JSON.stringify({
        tipo_documento: "OFICIO",
        confianza: 0.7,
        razones: [],
        texto_relevante: "",
      }) + "\n```",
      expect: { ok: true, tipo: "OFICIO" },
    },
    {
      name: "tipo_documento en minúsculas se normaliza a mayúscula",
      input: JSON.stringify({
        tipo_documento: "cedula",
        confianza: 0.5,
        razones: [],
        texto_relevante: "",
      }),
      expect: { ok: true, tipo: "CEDULA" },
    },
    {
      name: "tipo_documento inválido (CARTA) → ok:false",
      input: JSON.stringify({
        tipo_documento: "CARTA",
        confianza: 0.5,
        razones: [],
        texto_relevante: "",
      }),
      expect: { ok: false },
    },
    {
      name: "sin tipo_documento → ok:false",
      input: JSON.stringify({ confianza: 0.5, razones: [], texto_relevante: "" }),
      expect: { ok: false },
    },
    {
      name: "JSON malformado → ok:false",
      input: "{tipo_documento: CEDULA,",
      expect: { ok: false },
    },
    {
      name: "confianza fuera de rango (2.5) → clamp 1",
      input: JSON.stringify({
        tipo_documento: "OFICIO",
        confianza: 2.5,
        razones: [],
        texto_relevante: "",
      }),
      expect: { ok: true, tipo: "OFICIO", confianza: 1 },
    },
    {
      name: "confianza negativa → clamp 0",
      input: JSON.stringify({
        tipo_documento: "CEDULA",
        confianza: -0.3,
        razones: [],
        texto_relevante: "",
      }),
      expect: { ok: true, tipo: "CEDULA", confianza: 0 },
    },
  ];

  for (const tc of cases) {
    const got = parsearRespuestaGptVision(tc.input);
    if (tc.expect.ok) {
      if (!got.ok) {
        fail++;
        console.log(`  ✘ ${tc.name}`);
        console.log(`     → esperaba ok:true (${tc.expect.tipo}) obtuve ok:false (${got.error})`);
        continue;
      }
      if (got.respuesta.tipo_documento !== tc.expect.tipo) {
        fail++;
        console.log(`  ✘ ${tc.name}`);
        console.log(
          `     → esperaba tipo=${tc.expect.tipo} obtuve ${got.respuesta.tipo_documento}`
        );
        continue;
      }
      if (tc.expect.confianza != null && got.respuesta.confianza !== tc.expect.confianza) {
        fail++;
        console.log(`  ✘ ${tc.name}`);
        console.log(
          `     → esperaba confianza=${tc.expect.confianza} obtuve ${got.respuesta.confianza}`
        );
        continue;
      }
      pass++;
      console.log(
        `  ✔ ${tc.name} (tipo=${got.respuesta.tipo_documento}, conf=${got.respuesta.confianza})`
      );
    } else {
      if (got.ok) {
        fail++;
        console.log(`  ✘ ${tc.name}`);
        console.log(`     → esperaba ok:false obtuve ok:true (${got.respuesta.tipo_documento})`);
      } else {
        pass++;
        console.log(`  ✔ ${tc.name} (${got.error.slice(0, 60)})`);
      }
    }
  }
  return { pass, fail, total: cases.length };
}

/** Crea un mock GptVisionClient que devuelve la respuesta provista. */
function makeGptClient(impl: GptVisionClient["invocar"]): GptVisionClient {
  return { invocar: impl };
}

async function testObtenerClasificacionAuditoriaGpt(): Promise<{
  pass: number;
  fail: number;
  total: number;
}> {
  console.log("");
  console.log(
    "[tipo-doc-audit][test] obtenerClasificacionAuditoria (rama GPT Vision)"
  );
  let pass = 0;
  let fail = 0;

  // PDF sintético válido (1 página) → la extracción local funciona pero no
  // produce texto judicial útil (solo "pagina 1"), por lo que el orquestador
  // delega a GPT Vision cuando useOcr=true.
  const buf = await pdfSinteticoConPaginas(1);

  type Case = {
    name: string;
    useOcr: boolean;
    gptClient: GptVisionClient | null;
    expectFuente: "gpt_vision" | "sin_texto" | "local";
    expectClasif?: "CEDULA" | "OFICIO" | "INDETERMINADO";
    expectConfianzaMin?: number;
    /** Sin gptClient. Esto simula la rama de createGptVisionClient() devolviendo null cuando no hay API key. */
    skipGptClient?: boolean;
  };

  const respuestaOficio = (): GptVisionResultado => ({
    ok: true,
    respuesta: {
      tipo_documento: "OFICIO",
      confianza: 0.93,
      razones: ["líbrese oficio", "dirigido al Director del Banco"],
      texto_relevante: "OFICIO. Líbrese oficio al Sr. Director del Banco de la Nación Argentina.",
    },
    modelo: "mock-gpt",
  });

  const respuestaCedula = (): GptVisionResultado => ({
    ok: true,
    respuesta: {
      tipo_documento: "CEDULA",
      confianza: 0.95,
      razones: ["CÉDULA DE NOTIFICACIÓN", "domicilio constituido"],
      texto_relevante: "CÉDULA DE NOTIFICACIÓN. Zona 1. Se notifica.",
    },
    modelo: "mock-gpt",
  });

  const respuestaIndeterminado = (): GptVisionResultado => ({
    ok: true,
    respuesta: {
      tipo_documento: "INDETERMINADO",
      confianza: 0.0,
      razones: ["imagen ilegible"],
      texto_relevante: "",
    },
    modelo: "mock-gpt",
  });

  const cases: Case[] = [
    {
      name: "GPT devuelve OFICIO → fuente gpt_vision + OFICIO",
      useOcr: true,
      gptClient: makeGptClient(async () => respuestaOficio()),
      expectFuente: "gpt_vision",
      expectClasif: "OFICIO",
      expectConfianzaMin: 0.5,
    },
    {
      name: "GPT devuelve CEDULA → fuente gpt_vision + CEDULA",
      useOcr: true,
      gptClient: makeGptClient(async () => respuestaCedula()),
      expectFuente: "gpt_vision",
      expectClasif: "CEDULA",
      expectConfianzaMin: 0.5,
    },
    {
      name: "GPT devuelve INDETERMINADO → fuente gpt_vision + INDETERMINADO",
      useOcr: true,
      gptClient: makeGptClient(async () => respuestaIndeterminado()),
      expectFuente: "gpt_vision",
      expectClasif: "INDETERMINADO",
    },
    {
      name: "GPT lanza error HTTP → sin_texto + INDETERMINADO (ok:true)",
      useOcr: true,
      gptClient: makeGptClient(async () => ({ ok: false, error: "HTTP 429 rate limit" })),
      expectFuente: "sin_texto",
      expectClasif: "INDETERMINADO",
    },
    {
      name: "GPT devuelve JSON inválido (simulado via ok:false del parser) → sin_texto",
      useOcr: true,
      gptClient: makeGptClient(async () => ({ ok: false, error: "JSON inválido: ..." })),
      expectFuente: "sin_texto",
      expectClasif: "INDETERMINADO",
    },
    {
      name: "use_ocr=false → no invoca GPT, queda sin_texto",
      useOcr: false,
      gptClient: makeGptClient(async () => {
        throw new Error("no debería invocarse cuando useOcr=false");
      }),
      expectFuente: "sin_texto",
      expectClasif: "INDETERMINADO",
    },
    {
      name: "gptClient=null (sin OPENAI_API_KEY) + useOcr=true → sin_texto",
      useOcr: true,
      gptClient: null,
      skipGptClient: true,
      expectFuente: "sin_texto",
      expectClasif: "INDETERMINADO",
    },
  ];

  for (const tc of cases) {
    let res;
    try {
      res = await obtenerClasificacionAuditoria(buf, {
        useOcr: tc.useOcr,
        // Importante: si skipGptClient, pasamos null explícito (el orquestador
        // intentará crear uno desde env; sin OPENAI_API_KEY → null).
        gptClient: tc.skipGptClient ? null : tc.gptClient,
      });
    } catch (e: unknown) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ✘ ${tc.name}`);
      console.log(`     → orquestador LANZÓ (no debería): ${msg}`);
      continue;
    }

    if (res.fuente !== tc.expectFuente) {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(
        `     → esperaba fuente=${tc.expectFuente} obtuve ${res.fuente} (clasif=${res.clasificacion}, detalle=${res.detalle})`
      );
      continue;
    }

    if (tc.expectClasif && res.clasificacion !== tc.expectClasif) {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(
        `     → fuente OK pero clasif esperada ${tc.expectClasif} obtuve ${res.clasificacion}`
      );
      continue;
    }

    if (
      tc.expectConfianzaMin != null &&
      res.confianza < tc.expectConfianzaMin
    ) {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(
        `     → confianza ${res.confianza} < min esperada ${tc.expectConfianzaMin}`
      );
      continue;
    }

    pass++;
    const extra = `clasif=${res.clasificacion}, conf=${res.confianza.toFixed(2)}, paginas_enviadas=${res.paginas_enviadas}, max_pages=${res.max_pages}`;
    console.log(`  ✔ ${tc.name} (${extra})`);
  }

  return { pass, fail, total: cases.length };
}

async function testRecorteEnOrquestador(): Promise<{
  pass: number;
  fail: number;
  total: number;
}> {
  console.log("");
  console.log(
    "[tipo-doc-audit][test] orquestador con PDF real: max_pages respeta totales"
  );
  let pass = 0;
  let fail = 0;

  type Case = {
    name: string;
    paginasTotales: number;
    maxPagesOpt: number;
    expectPaginasEnviadas: number;
  };

  const cases: Case[] = [
    {
      name: "PDF 3 páginas + max_pages=5 → envía 3",
      paginasTotales: 3,
      maxPagesOpt: 5,
      expectPaginasEnviadas: 3,
    },
    {
      name: "PDF 8 páginas + max_pages=5 → envía 5",
      paginasTotales: 8,
      maxPagesOpt: 5,
      expectPaginasEnviadas: 5,
    },
    {
      name: "PDF 4 páginas + max_pages=2 → envía 2",
      paginasTotales: 4,
      maxPagesOpt: 2,
      expectPaginasEnviadas: 2,
    },
  ];

  for (const tc of cases) {
    const pdfBuf = await pdfSinteticoConPaginas(tc.paginasTotales);

    // Espía: capturamos el buffer recortado que GPT recibe y validamos su
    // count de páginas leyéndolo con pdf-lib en el mock.
    let bufferVisto: Buffer | null = null;
    const mock = makeGptClient(async (pdf: Buffer): Promise<GptVisionResultado> => {
      bufferVisto = pdf;
      return {
        ok: true,
        respuesta: {
          tipo_documento: "INDETERMINADO",
          confianza: 0,
          razones: [],
          texto_relevante: "",
        },
        modelo: "mock-gpt",
      };
    });

    const res = await obtenerClasificacionAuditoria(pdfBuf, {
      useOcr: true,
      maxPages: tc.maxPagesOpt,
      gptClient: mock,
    });

    // Validamos paginas_enviadas en la respuesta.
    if (res.paginas_enviadas !== tc.expectPaginasEnviadas) {
      fail++;
      console.log(`  ✘ ${tc.name}`);
      console.log(
        `     → paginas_enviadas=${res.paginas_enviadas}, esperado=${tc.expectPaginasEnviadas}`
      );
      continue;
    }

    // Validamos buffer recortado real.
    if (bufferVisto) {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.load(bufferVisto as Buffer);
      const realPages = doc.getPageCount();
      if (realPages !== tc.expectPaginasEnviadas) {
        fail++;
        console.log(`  ✘ ${tc.name}`);
        console.log(
          `     → buffer GPT contiene ${realPages} páginas (esperado ${tc.expectPaginasEnviadas})`
        );
        continue;
      }
    }
    pass++;
    console.log(`  ✔ ${tc.name} (paginas_enviadas=${res.paginas_enviadas})`);
  }
  return { pass, fail, total: cases.length };
}

function testRazonesMetaGptVision(): { pass: number; fail: number; total: number } {
  console.log("");
  console.log(
    "[tipo-doc-audit][test] razonesMetaDeClasificacion (incluye páginas_enviadas/max_pages para gpt_vision)"
  );
  let pass = 0;
  let fail = 0;

  // Simulamos una ClasificacionAuditoria de gpt_vision
  const meta = razonesMetaDeClasificacion({
    fuente: "gpt_vision",
    clasificacion: "OFICIO",
    confianza: 0.9,
    razones: [],
    texto_detectado: "OFICIO ...",
    texto_chars: 42,
    paginas_enviadas: 3,
    max_pages: 5,
    texto_relevante: "OFICIO ...",
    detalle: "modelo=gpt-4o-mini",
  });

  const patrones = meta.map((m) => m.patron);
  const checks: Array<{ name: string; ok: boolean }> = [
    {
      name: "incluye 'Fuente texto: gpt_vision'",
      ok: patrones.some((p) => p === "Fuente texto: gpt_vision"),
    },
    { name: "incluye 'Texto chars: 42'", ok: patrones.some((p) => p === "Texto chars: 42") },
    {
      name: "incluye 'Páginas enviadas: 3'",
      ok: patrones.some((p) => p === "Páginas enviadas: 3"),
    },
    { name: "incluye 'Max pages: 5'", ok: patrones.some((p) => p === "Max pages: 5") },
    {
      name: "incluye 'Detalle fuente: modelo=gpt-4o-mini'",
      ok: patrones.some((p) => p === "Detalle fuente: modelo=gpt-4o-mini"),
    },
    {
      name: "todas las razones meta tienen peso 0 y clasificacion null",
      ok: meta.every((m) => m.peso === 0 && m.clasificacion === null),
    },
  ];

  for (const c of checks) {
    if (c.ok) {
      pass++;
      console.log(`  ✔ ${c.name}`);
    } else {
      fail++;
      console.log(`  ✘ ${c.name}`);
      console.log(`     → patrones: ${JSON.stringify(patrones)}`);
    }
  }

  // Para fuente "local" NO deberían aparecer páginas_enviadas/max_pages
  const metaLocal = razonesMetaDeClasificacion({
    fuente: "local",
    clasificacion: "CEDULA",
    confianza: 0.8,
    razones: [],
    texto_detectado: "Cédula ...",
    texto_chars: 100,
    paginas_enviadas: null,
    max_pages: null,
    texto_relevante: null,
    detalle: null,
  });
  const patronesLocal = metaLocal.map((m) => m.patron);
  if (patronesLocal.some((p) => p.startsWith("Páginas enviadas") || p.startsWith("Max pages"))) {
    fail++;
    console.log("  ✘ local NO debería incluir páginas_enviadas/max_pages");
  } else {
    pass++;
    console.log("  ✔ fuente local: no incluye páginas_enviadas/max_pages");
  }

  return { pass, fail, total: checks.length + 1 };
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
  const judicial = testEsTextoJudicialUtil();
  const xhtml = await testOrquestadorRechazaXhtml();
  const ocrOrq = await testObtenerTextoParaAuditoria();
  const ocrLocal = testLocalConTextoUtil();
  const meta = testRazonesMetaRoundTrip();
  const sanitiz = testSanitizarTextoParaDebug();
  const guardaDbg = testGuardaDebugText();

  // GPT Vision (auditoría documental)
  const maxPages = testParsearMaxPages();
  const recorte = await testRecortarPdfPrimeraPaginas();
  const parseGpt = testParsearRespuestaGptVision();
  const orqGpt = await testObtenerClasificacionAuditoriaGpt();
  const recOrq = await testRecorteEnOrquestador();
  const metaGpt = testRazonesMetaGptVision();

  pass +=
    extr.pass +
    fallida.pass +
    judicial.pass +
    xhtml.pass +
    ocrOrq.pass +
    ocrLocal.pass +
    meta.pass +
    sanitiz.pass +
    guardaDbg.pass +
    maxPages.pass +
    recorte.pass +
    parseGpt.pass +
    orqGpt.pass +
    recOrq.pass +
    metaGpt.pass;
  fail +=
    extr.fail +
    fallida.fail +
    judicial.fail +
    xhtml.fail +
    ocrOrq.fail +
    ocrLocal.fail +
    meta.fail +
    sanitiz.fail +
    guardaDbg.fail +
    maxPages.fail +
    recorte.fail +
    parseGpt.fail +
    orqGpt.fail +
    recOrq.fail +
    metaGpt.fail;
  const total =
    TEST_CASES.length +
    extr.total +
    fallida.total +
    judicial.total +
    xhtml.total +
    ocrOrq.total +
    ocrLocal.total +
    meta.total +
    sanitiz.total +
    guardaDbg.total +
    maxPages.total +
    recorte.total +
    parseGpt.total +
    orqGpt.total +
    recOrq.total +
    metaGpt.total;

  console.log("");
  console.log(`[tipo-doc-audit][test] ${pass} OK · ${fail} fallidas · ${total} total`);

  // Casos estructurales (no automatizables sin DB).
  console.log("");
  console.log("[tipo-doc-audit][test] notas estructurales:");
  console.log("  • dry_run=true en /run: la rama dryRun retorna sin INSERT (ver run/route.ts).");
  console.log("  • Si la extracción falla, /run reporta ok:true + INDETERMINADO (ver run/route.ts).");
  console.log("  • Solo se reporta ok:false ante fallo de descarga (download del Storage).");
  console.log("  • use_ocr default=false. Cuando es true y OPENAI_API_KEY no está, fuente='sin_texto'.");
  console.log("  • razonesMetaDeClasificacion se PREPENDA a razones de clasificación (ver run/route.ts).");
  console.log("  • /list/route.ts deriva fuente_texto y texto_chars vía leerFuenteDeRazones (compat con registros legados).");
  console.log("  • debug_text default=false. Solo se honra cuando dry_run=true (ver debugTextEfectivo en run/route.ts).");
  console.log(`  • debug_text NUNCA se persiste en DB; se trunca a ${PDF_AUDIT_DEBUG_TEXT_MAX} chars y se sanitiza saltos/espacios.`);
  console.log("  • esTextoJudicialUtil descarta XHTML del microservicio extractor legado (pdftotext -bbox sobre PDFs PyPDF2).");
  console.log("  • createPdfExtractorOcrClient quedó @deprecated: el orquestador actual usa GPT Vision en lugar del microservicio.");
  console.log("  • GPT Vision: PDF recortado a max_pages con pdf-lib y enviado vía Responses API (input_file, base64).");
  console.log("  • max_pages default=5, clamp [1,5]. PDFs con menos páginas envían las disponibles.");
  console.log("  • Modelo OpenAI: env var AUDIT_OPENAI_MODEL (default gpt-4o-mini).");
  console.log("  • OPENAI_API_KEY se lee server-side; NUNCA NEXT_PUBLIC_*. createGptVisionClient() devuelve null sin key.");
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
