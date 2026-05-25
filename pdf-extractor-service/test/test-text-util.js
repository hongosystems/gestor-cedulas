/**
 * Tests para text-util.js — verifica que esTextoUtil descarta XHTML residual
 * de pdftotext -bbox sobre PDFs sin texto seleccionable (caso real observado
 * en producción con PDFs generados por PyPDF2).
 *
 * Ejecutar:
 *   npm test
 *   # o:
 *   node --test test/
 *
 * Requiere Node 20+ (test runner built-in).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analizarTexto,
  contarPalabrasAlfabeticas,
  esTextoUtil,
  HTML_MARKERS,
  limpiarTexto,
  MIN_CHARS_UTILES,
  MIN_PALABRAS_ALFABETICAS,
} from "../text-util.js";

// =============================================================================
// Fixtures
// =============================================================================

const XHTML_PYPDF2_VACIO_PROD =
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

const XHTML_PAGE_VACIO_MINIMO =
  "<html><body><doc><page width='594.3' height='840.5'></page></doc></body></html>";

const TEXTO_CEDULA_REAL =
  "CÉDULA DE NOTIFICACIÓN\n" +
  "JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL N° 17, Secretaría Única.\n" +
  "Expte. N° 105662/2025 caratulado: TAPIA, CLAUDIA VERONICA Y OTROS c/ FORNERO, MIGUEL ANTONIO Y OTROS s/DAÑOS Y PERJUICIOS\n" +
  "Se notifica al destinatario en su domicilio constituido la resolución de fojas...";

const TEXTO_OFICIO_REAL =
  "OFICIO\n" +
  "Buenos Aires, 15 de marzo de 2025\n" +
  "Al Sr. Director del Banco de la Nación Argentina\n" +
  "S / D\n" +
  "Tengo el agrado de dirigirme a Ud. en los autos del expediente N° 12345/2024 caratulado: PEREZ, ANDRES c/ GOMEZ, JUAN s/ COBRO DE PESOS, que tramita ante el Juzgado Nacional Civil N° 1, a fin de solicitar...";

// =============================================================================
// limpiarTexto
// =============================================================================

test("limpiarTexto: input no-string devuelve cadena vacía", () => {
  assert.equal(limpiarTexto(null), "");
  assert.equal(limpiarTexto(undefined), "");
  assert.equal(limpiarTexto(123), "");
  assert.equal(limpiarTexto({}), "");
  assert.equal(limpiarTexto(""), "");
});

test("limpiarTexto: strip de tags HTML y entidades", () => {
  const got = limpiarTexto('<html><body>Hola &amp; mundo &#x123; fin</body></html>');
  // Tras strip y normalizar: "Hola mundo fin" (con &#x123 no soportado por
  // nuestro regex; queda como prefijo "&#x")
  assert.ok(got.includes("Hola"));
  assert.ok(got.includes("mundo"));
  assert.ok(got.includes("fin"));
  assert.equal(got.includes("<"), false);
  assert.equal(got.includes(">"), false);
});

test("limpiarTexto: colapsa whitespace múltiple", () => {
  const got = limpiarTexto("hola      mundo\n\n\nfin");
  assert.equal(got, "hola mundo fin");
});

test("limpiarTexto: XHTML PyPDF2 queda con solo dimensiones numéricas", () => {
  const got = limpiarTexto(XHTML_PYPDF2_VACIO_PROD);
  assert.equal(got.includes("<"), false);
  assert.equal(got.includes(">"), false);
  // Las dimensiones quedan como números sueltos (no palabras alfabéticas).
  assert.ok(got.length < 100, `texto limpio debería ser corto, fue: "${got}"`);
});

// =============================================================================
// contarPalabrasAlfabeticas
// =============================================================================

test("contarPalabrasAlfabeticas: cuenta palabras >= 3 letras", () => {
  assert.equal(contarPalabrasAlfabeticas("ab cd efg hij"), 2);
  assert.equal(contarPalabrasAlfabeticas("hola mundo notificación"), 3);
  assert.equal(contarPalabrasAlfabeticas(""), 0);
  assert.equal(contarPalabrasAlfabeticas(null), 0);
});

test("contarPalabrasAlfabeticas: soporta acentos unicode (\\p{L})", () => {
  assert.equal(contarPalabrasAlfabeticas("cédula notificación juzgado"), 3);
  assert.equal(contarPalabrasAlfabeticas("cita expediente número"), 3);
});

test("contarPalabrasAlfabeticas: ignora números y símbolos puros", () => {
  assert.equal(contarPalabrasAlfabeticas("123 456 789 0000"), 0);
  assert.equal(contarPalabrasAlfabeticas("594.3 840.5 #### @@@"), 0);
});

// =============================================================================
// HTML_MARKERS
// =============================================================================

test("HTML_MARKERS: detecta todos los markers conocidos", () => {
  const muestras = [
    { input: "<!DOCTYPE html ...>", expected: true, marker: "doctype" },
    { input: "<html lang='es'>", expected: true, marker: "html" },
    { input: "<body>hola</body>", expected: true, marker: "body" },
    { input: "<doc>contenido</doc>", expected: true, marker: "doc" },
    { input: '<page width="594" height="840">', expected: true, marker: "page width=" },
    {
      input: 'Producer" content="PyPDF2"',
      expected: true,
      marker: "Producer PyPDF2",
    },
    { input: "texto plano sin tags", expected: false, marker: "(ninguno)" },
  ];

  for (const { input, expected, marker } of muestras) {
    const matched = HTML_MARKERS.some((re) => re.test(input));
    assert.equal(
      matched,
      expected,
      `marker "${marker}" en "${input}" matched=${matched}, esperado=${expected}`
    );
  }
});

// =============================================================================
// esTextoUtil — HARD REJECTs
// =============================================================================

test("esTextoUtil: null/undefined/no-string → false", () => {
  assert.equal(esTextoUtil(null), false);
  assert.equal(esTextoUtil(undefined), false);
  assert.equal(esTextoUtil(""), false);
  assert.equal(esTextoUtil(123), false);
  assert.equal(esTextoUtil({}), false);
  assert.equal(esTextoUtil([]), false);
});

test("esTextoUtil: XHTML PyPDF2 vacío (caso real prod) → false", () => {
  // Este es exactamente el output que el endpoint /extract devolvía como
  // raw_preview antes del fix, bloqueando el fallback a Tesseract.
  assert.equal(esTextoUtil(XHTML_PYPDF2_VACIO_PROD), false);
});

test("esTextoUtil: XHTML mínimo con <page width=...> → false", () => {
  assert.equal(esTextoUtil(XHTML_PAGE_VACIO_MINIMO), false);
});

test("esTextoUtil: cualquier marker HTML descarta aunque haya texto", () => {
  // Texto con CEDULA + Juzgado + 200 chars de léxico, pero con marker.
  const conMarker = `<!DOCTYPE html><body>${TEXTO_CEDULA_REAL}</body>`;
  assert.equal(esTextoUtil(conMarker), false);
});

test("esTextoUtil: texto plano < MIN_CHARS_UTILES → false", () => {
  const corto = "OFICIO al Sr."; // 13 chars limpios
  assert.equal(esTextoUtil(corto), false);
});

test("esTextoUtil: texto con muchos chars pero pocas palabras alfabéticas → false", () => {
  const numeros = "1234567890 ".repeat(20); // 220 chars, 0 palabras alfa
  assert.equal(esTextoUtil(numeros), false);
});

// =============================================================================
// esTextoUtil — ACCEPTs
// =============================================================================

test("esTextoUtil: texto CEDULA real (> 100 chars, > 5 palabras) → true", () => {
  assert.equal(esTextoUtil(TEXTO_CEDULA_REAL), true);
});

test("esTextoUtil: texto OFICIO real → true", () => {
  assert.equal(esTextoUtil(TEXTO_OFICIO_REAL), true);
});

test("esTextoUtil: texto extenso en español con acentos → true", () => {
  const texto =
    "Buenos Aires veintidós de mayo de dos mil veinticinco información detallada respecto situación particular contribuyente conforme normativa vigente aplicable según notificación emitida.";
  assert.equal(esTextoUtil(texto), true);
});

// =============================================================================
// esTextoUtil — opciones
// =============================================================================

test("esTextoUtil: minChars custom respeta el umbral", () => {
  // 4 palabras alfabéticas: "OFICIO", "Director", "del", "Banco".
  // Forzamos minPalabras bajo para aislar el test al criterio minChars.
  const corto = "OFICIO al Sr. Director del Banco";
  assert.equal(esTextoUtil(corto, { minChars: 100, minPalabras: 3 }), false);
  assert.equal(esTextoUtil(corto, { minChars: 20, minPalabras: 3 }), true);
});

test("esTextoUtil: minPalabras custom respeta el umbral", () => {
  const seisPalabras = "uno dos tres cuatro cinco seis";
  assert.equal(esTextoUtil(seisPalabras, { minChars: 10, minPalabras: 5 }), true);
  assert.equal(esTextoUtil(seisPalabras, { minChars: 10, minPalabras: 10 }), false);
});

// =============================================================================
// analizarTexto — diagnóstico para logs
// =============================================================================

test("analizarTexto: input vacío → motivo informativo", () => {
  const r = analizarTexto("");
  assert.equal(r.util, false);
  assert.match(r.motivo, /vacío/);
});

test("analizarTexto: marker HTML → motivo menciona el marker", () => {
  const r = analizarTexto(XHTML_PYPDF2_VACIO_PROD);
  assert.equal(r.util, false);
  assert.match(r.motivo, /marcador HTML\/XML/);
});

test("analizarTexto: corto → motivo menciona chars insuficientes", () => {
  const r = analizarTexto("hola mundo fin");
  assert.equal(r.util, false);
  assert.match(r.motivo, /chars/);
});

test("analizarTexto: texto útil → motivo 'ok'", () => {
  const r = analizarTexto(TEXTO_CEDULA_REAL);
  assert.equal(r.util, true);
  assert.equal(r.motivo, "ok");
  assert.ok(r.chars_limpio > MIN_CHARS_UTILES);
  assert.ok(r.palabras >= MIN_PALABRAS_ALFABETICAS);
});

// =============================================================================
// Consistencia entre esTextoUtil y analizarTexto
// =============================================================================

test("consistencia: esTextoUtil y analizarTexto siempre coinciden en util", () => {
  const muestras = [
    "",
    null,
    undefined,
    XHTML_PYPDF2_VACIO_PROD,
    XHTML_PAGE_VACIO_MINIMO,
    TEXTO_CEDULA_REAL,
    TEXTO_OFICIO_REAL,
    "corto",
    "1234567890 ".repeat(20),
    "abc def ghi jkl mno pqr stu vwx".repeat(5),
  ];

  for (const m of muestras) {
    assert.equal(
      esTextoUtil(m),
      analizarTexto(m).util,
      `desacuerdo en input: ${JSON.stringify(String(m).slice(0, 50))}`
    );
  }
});
