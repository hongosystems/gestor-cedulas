/**
 * pdf-extractor-service · text-util.js
 *
 * Helpers semánticos para decidir si un texto extraído por Poppler/Tesseract es
 * "útil" para los regexes de carátula/juzgado del endpoint /extract. El módulo
 * es aislado (sin side effects) para poder testear con `node --test`.
 *
 * Racional del cambio (ver troubleshooting/PDF_EXTRACTOR_BBOX_XHTML_BUG en el
 * monorepo `gestor-cedulas`):
 *
 *   Antes, `extractTextWithPoppler` tenía una estrategia `pdftotext -bbox` que
 *   para PDFs sin texto seleccionable (típicamente generados por PyPDF2)
 *   devuelve XHTML con `<page width="..."/>` y nada más. Ese XHTML supera el
 *   umbral antiguo (`length < 100`) y bloqueaba el fallback a Tesseract,
 *   resultando en `/extract` devolviendo `raw_preview` con tags HTML/XML y
 *   `caratula: null, juzgado: null`.
 *
 *   La solución es doble:
 *     1) Eliminar la estrategia `-bbox` (sólo texto plano).
 *     2) Decidir si el texto es útil con `esTextoUtil`, que tira HARD los
 *        markers HTML/XML y exige >= MIN_CHARS_UTILES caracteres no-tag.
 */

// =============================================================================
// Constantes
// =============================================================================

/**
 * Mínimo de caracteres tras stripear tags HTML/XML y normalizar whitespace
 * para considerar el texto utilizable. Los headers reales de una primera
 * página de cédula u oficio (carátula + juzgado + número de expediente)
 * superan este umbral con margen.
 */
export const MIN_CHARS_UTILES = 100;

/**
 * Mínimo de palabras alfabéticas (>= 3 letras) en el texto limpio. Evita que
 * un PDF con solo números/símbolos (recibos, plantillas vacías) pase el filtro.
 */
export const MIN_PALABRAS_ALFABETICAS = 5;

/**
 * Marcadores que evidencian que el texto NO es contenido real sino estructura
 * residual del PDF/extractor. Cualquier match descarta el texto.
 */
export const HTML_MARKERS = Object.freeze([
  /<!DOCTYPE\s+html/i,
  /<html\b/i,
  /<\/?body\b/i,
  /<\/?doc\b/i,
  /<page\s+width\s*=/i,
  /Producer["']?\s*content\s*=\s*["']?PyPDF2/i,
]);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Quita tags HTML/XML, entidades, y colapsa whitespace. Devuelve el texto
 * "limpio" sin estructura.
 *
 * Pure function: no muta el input, no usa side effects.
 *
 * @param {string} texto
 * @returns {string}
 */
export function limpiarTexto(texto) {
  if (typeof texto !== "string" || texto.length === 0) return "";
  return texto
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cuenta las "palabras" alfabéticas (>= 3 letras) en el texto limpio. Usa
 * `\p{L}` para soportar acentos y caracteres unicode (español).
 *
 * @param {string} textoLimpio - Texto previamente pasado por `limpiarTexto`.
 * @returns {number}
 */
export function contarPalabrasAlfabeticas(textoLimpio) {
  if (typeof textoLimpio !== "string" || textoLimpio.length === 0) return 0;
  return textoLimpio.split(" ").filter((w) => /^\p{L}{3,}$/u.test(w)).length;
}

/**
 * Devuelve `true` si `texto` parece contenido útil para los regexes de
 * carátula/juzgado. `false` si es XHTML residual, vacío, o muy pobre.
 *
 * Reglas (en orden):
 *   1) HARD reject: input null/undefined/no-string/vacío.
 *   2) HARD reject por markers HTML/XML (PyPDF2, page width, doctype, etc).
 *   3) HARD reject si el texto limpio tiene < `minChars` caracteres.
 *   4) HARD reject si tiene < `minPalabras` palabras alfabéticas.
 *   5) ACCEPT.
 *
 * No lanza. Acepta `string | null | undefined`.
 *
 * @param {string|null|undefined} texto
 * @param {object} [opts]
 * @param {number} [opts.minChars=MIN_CHARS_UTILES]
 * @param {number} [opts.minPalabras=MIN_PALABRAS_ALFABETICAS]
 * @returns {boolean}
 */
export function esTextoUtil(texto, opts = {}) {
  const minChars = Number.isFinite(opts.minChars) ? opts.minChars : MIN_CHARS_UTILES;
  const minPalabras = Number.isFinite(opts.minPalabras)
    ? opts.minPalabras
    : MIN_PALABRAS_ALFABETICAS;

  if (typeof texto !== "string" || texto.length === 0) return false;

  for (const re of HTML_MARKERS) {
    if (re.test(texto)) return false;
  }

  const limpio = limpiarTexto(texto);
  if (limpio.length < minChars) return false;

  const palabras = contarPalabrasAlfabeticas(limpio);
  if (palabras < minPalabras) return false;

  return true;
}

/**
 * Variante diagnóstica: devuelve `{ util: boolean, motivo: string }`. Útil para
 * logs claros del endpoint /extract.
 *
 * @param {string|null|undefined} texto
 * @param {object} [opts]
 * @returns {{ util: boolean, motivo: string, chars_limpio: number, palabras: number }}
 */
export function analizarTexto(texto, opts = {}) {
  const minChars = Number.isFinite(opts.minChars) ? opts.minChars : MIN_CHARS_UTILES;
  const minPalabras = Number.isFinite(opts.minPalabras)
    ? opts.minPalabras
    : MIN_PALABRAS_ALFABETICAS;

  if (typeof texto !== "string" || texto.length === 0) {
    return { util: false, motivo: "texto vacío o no-string", chars_limpio: 0, palabras: 0 };
  }

  for (const re of HTML_MARKERS) {
    if (re.test(texto)) {
      return {
        util: false,
        motivo: `marcador HTML/XML detectado (${re.source})`,
        chars_limpio: 0,
        palabras: 0,
      };
    }
  }

  const limpio = limpiarTexto(texto);
  const palabras = contarPalabrasAlfabeticas(limpio);

  if (limpio.length < minChars) {
    return {
      util: false,
      motivo: `texto limpio insuficiente (${limpio.length} chars; mínimo ${minChars})`,
      chars_limpio: limpio.length,
      palabras,
    };
  }

  if (palabras < minPalabras) {
    return {
      util: false,
      motivo: `pocas palabras alfabéticas (${palabras}; mínimo ${minPalabras})`,
      chars_limpio: limpio.length,
      palabras,
    };
  }

  return {
    util: true,
    motivo: "ok",
    chars_limpio: limpio.length,
    palabras,
  };
}
