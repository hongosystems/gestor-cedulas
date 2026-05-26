import { supabaseService } from "@/lib/supabase-server";
import { parseVisionOcrJson } from "@/lib/vision-json-repair";
import {
  extraerDestinatarioOficio,
  extraerDestinatarioOficioDePaginas,
} from "@/lib/oficio-destinatario";

/**
 * Helper compartido por:
 *   GET /api/admin/auditoria-tipo-documento-pdf/preview
 *   POST /api/admin/auditoria-tipo-documento-pdf/run
 *
 * Reglas duras (alineadas con cedula-mvp y con lib/pjn-payload.ts):
 *   - /procesar         SIEMPRE corresponde a tipoDocumento='CEDULA'
 *   - /procesar-oficio  SIEMPRE corresponde a tipoDocumento='OFICIO'
 *   - NUNCA inferir tipoDocumento desde el OCR de Railway en este flujo
 *   - NUNCA usar columna legacy `tipo` (no existe en gestor-cedulas)
 *   - NUNCA fallback `tipoDocumento || 'CEDULA'`
 *
 * Esta auditoría es 100% read-only respecto de cedulas / Storage:
 *   - NO modifica cedulas.tipo_documento
 *   - NO modifica pjn_cargado_at, estado_ocr, pdf_acredita_url, pdf_url, pdf_acredita_path
 *   - NO toca archivos en Storage
 *
 * Fase 7 (apply): NO implementada. Punto de extensión documentado al final.
 */

export const STORAGE_BUCKET = "cedulas";
export const TEXTO_DETECTADO_MAX = 4000;
export const RAZONES_MAX = 40;
export const PDF_AUDIT_MAX_PAGES = 4;
/**
 * Umbral histórico (caracteres crudos). Mantenido para retrocompatibilidad de
 * tests y diagnóstico, pero NO se usa más como criterio de utilidad — el
 * filtro real ahora es semántico vía `esTextoJudicialUtil`. Ver doc de esa
 * función para el racional (XHTML vacío de pdftotext -bbox supera fácilmente
 * los 30 chars y es engañoso).
 */
export const PDF_AUDIT_TEXTO_MIN_UTIL = 30;

/**
 * Marcadores que indican que el texto recibido NO es contenido judicial sino
 * estructura HTML/XML residual del microservicio extractor (típicamente la
 * estrategia `pdftotext -bbox` aplicada sobre PDFs sin texto seleccionable —
 * ej. PDFs generados por PyPDF2). Cualquier match descarta el texto.
 */
const PDF_AUDIT_HTML_MARKERS: readonly RegExp[] = [
  /<!DOCTYPE\s+html/i,
  /<html\b/i,
  /<\/?body\b/i,
  /<\/?doc\b/i,
  /<page\s+width\s*=/i,
  /Producer["']?\s*content\s*=\s*["']?PyPDF2/i,
];

/**
 * Palabras "ancla" del dominio judicial argentino. Si el texto limpio contiene
 * al menos una de ellas, lo consideramos contenido legítimo aún sin matchear
 * los patrones de scoring CEDULA/OFICIO (eso ya se decide en el clasificador).
 *
 * Lista referencial (no exclusiva): la utilidad también se concede si el texto
 * tiene mucho léxico (≥ 8 palabras alfabéticas) como fallback permisivo, para
 * evitar falsos negativos en PDFs con contenido judicial inusual.
 */
const PDF_AUDIT_PALABRAS_JUDICIALES: readonly string[] = [
  "cedula",
  "cédula",
  "oficio",
  "notificacion",
  "notificación",
  "juzgado",
  "expediente",
  "autos",
  "caratula",
  "carátula",
  "domicilio",
  "secretaria",
  "secretaría",
  "director",
  "registro",
  "banco",
  "hospital",
  "anses",
  "afip",
  "notifica",
  "destinatario",
  "líbrese",
  "librese",
  "tribunal",
  "demanda",
  "acreedor",
  "deudor",
  "actor",
  "demandado",
];

/**
 * Mínimo de caracteres alfabéticos (sin tags ni puntuación) que debe tener el
 * texto limpio para considerarse aprovechable.
 */
const PDF_AUDIT_LIMPIO_MIN_CHARS = 20;

/**
 * Mínimo de "palabras" alfabéticas (≥ 3 letras) que debe tener el texto limpio
 * para considerarse aprovechable.
 */
const PDF_AUDIT_LIMPIO_MIN_PALABRAS = 3;

/**
 * Si el texto NO matchea ninguna palabra judicial pero tiene al menos este
 * número de palabras alfabéticas, igual lo aceptamos como útil (fallback
 * permisivo: el clasificador puede no encontrar patrones y devolver
 * INDETERMINADO con razones, pero el contenido textual es real).
 */
const PDF_AUDIT_LIMPIO_FALLBACK_PALABRAS = 8;

/**
 * Devuelve `true` si `texto` parece contenido judicial/documental real y `false`
 * si es estructura HTML/XML vacía, ruido, o demasiado pobre para clasificar.
 *
 * Reglas (defense in depth):
 *
 *   1) HARD reject por marcadores HTML/XML del microservicio (PDF_AUDIT_HTML_MARKERS).
 *   2) Strip de tags + decimales de entidades + normalización de whitespace.
 *   3) HARD reject si el texto limpio queda con < PDF_AUDIT_LIMPIO_MIN_CHARS
 *      caracteres alfabéticos o < PDF_AUDIT_LIMPIO_MIN_PALABRAS palabras.
 *   4) ACCEPT si contiene alguna palabra del dominio judicial.
 *   5) ACCEPT (fallback) si tiene >= PDF_AUDIT_LIMPIO_FALLBACK_PALABRAS palabras
 *      alfabéticas — el clasificador puede no encontrar patrones pero el
 *      contenido es real.
 *   6) REJECT en cualquier otro caso.
 *
 * Acepta `string | null | undefined` sin lanzar (devuelve `false`).
 */
export function esTextoJudicialUtil(texto: string | null | undefined): boolean {
  if (typeof texto !== "string" || texto.length === 0) return false;

  for (const re of PDF_AUDIT_HTML_MARKERS) {
    if (re.test(texto)) return false;
  }

  // Strip tags + entidades + colapsar whitespace.
  const sinTags = texto
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#\d+;/g, " ");
  const limpioLower = sinTags.toLowerCase();
  const soloLetras = limpioLower
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (soloLetras.length < PDF_AUDIT_LIMPIO_MIN_CHARS) return false;

  const palabras = soloLetras
    .split(" ")
    .filter((w) => /^\p{L}{3,}$/u.test(w));
  if (palabras.length < PDF_AUDIT_LIMPIO_MIN_PALABRAS) return false;

  for (const w of PDF_AUDIT_PALABRAS_JUDICIALES) {
    // includes simple — comparamos sobre limpioLower que ya está en lowercase
    // y sin tags pero con puntuación; alcanza para detectar "cédula", "OFICIO",
    // "Líbrese oficio", etc.
    if (limpioLower.includes(w)) return true;
  }

  return palabras.length >= PDF_AUDIT_LIMPIO_FALLBACK_PALABRAS;
}
/**
 * Timeout para llamadas al microservicio pdf-extractor-service. El microservicio
 * cancela a los 28s (ENDPOINT_TIMEOUT), así que dejamos margen para el handshake.
 */
export const PDF_AUDIT_OCR_TIMEOUT_MS = 35_000;

// =============================================================================
// GPT Vision (auditoría documental)
// -----------------------------------------------------------------------------
// Cuando la extracción local con pdf-parse no da texto judicial útil, recortamos
// el PDF a las primeras N páginas con pdf-lib y lo enviamos al modelo Vision de
// OpenAI vía la Responses API (campo `input_file`). El modelo devuelve JSON
// estructurado con la clasificación CEDULA/OFICIO/INDETERMINADO.
//
// NO se usa para flujos productivos (OCR de cédulas/oficios sigue en Railway).
// NO se llama a /procesar ni /procesar-oficio de cedula-mvp.
// =============================================================================

/** Default y máximo absoluto de páginas que se envían al modelo Vision. */
export const AUDIT_MAX_PAGES_DEFAULT = 5;
export const AUDIT_MAX_PAGES_MAX = 5;
export const AUDIT_MAX_PAGES_MIN = 1;

/** Modelo OpenAI a usar para clasificación (env var `AUDIT_OPENAI_MODEL`). */
export const AUDIT_OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

/** Timeout para la llamada a OpenAI Responses. Vision con 5 páginas suele tardar 3–8s. */
export const AUDIT_GPT_TIMEOUT_MS = 60_000;

/**
 * Cota usada para normalizar la confianza a [0,1].
 * Empíricamente: ~3 patrones medianos dominantes ⇒ confianza 1.0.
 */
const CONFIANZA_COTA = 9;

export type ClasificacionPdf = "CEDULA" | "OFICIO" | "INDETERMINADO";

/**
 * Una razón puede ser:
 *   - "evidencia" (clasificacion CEDULA u OFICIO con peso >= 1)
 *   - "meta" (clasificacion null, peso 0) — ej. "No se pudo extraer texto del PDF"
 * Las razones meta NO contribuyen al scoring; sólo documentan el resultado.
 */
export type RazonClasificacion = {
  patron: string;
  clasificacion: "CEDULA" | "OFICIO" | null;
  peso: number;
  pagina: number | null;
};

export type ClasificacionResultado = {
  clasificacion: ClasificacionPdf;
  confianza: number;
  razones: RazonClasificacion[];
  texto_detectado: string;
};

export const RAZON_EXTRACCION_FALLIDA = "No se pudo extraer texto localmente del PDF";

/**
 * Construye el resultado de clasificación cuando no se pudo extraer texto del PDF.
 * Por contrato (ver /run/route.ts) el ítem queda OK pero INDETERMINADO.
 */
export function clasificacionExtraccionFallida(
  detalle?: string
): ClasificacionResultado {
  const patron = detalle
    ? `${RAZON_EXTRACCION_FALLIDA}: ${detalle}`
    : RAZON_EXTRACCION_FALLIDA;
  return {
    clasificacion: "INDETERMINADO",
    confianza: 0,
    razones: [
      {
        patron,
        clasificacion: null,
        peso: 0,
        pagina: null,
      },
    ],
    texto_detectado: "",
  };
}

type PatronDef = {
  patron: string;
  /** Regex sobre texto ya normalizado (mayúsculas, sin tildes, una línea). */
  regex: RegExp;
  clasificacion: "CEDULA" | "OFICIO";
  peso: number;
};

/**
 * Patrones OFICIO. Fuente: instrucción Fase 4 + lectura del corpus existente
 * (railway-service, oficios reales del estudio).
 *
 * `peso` representa cuán específico/exclusivo es el patrón para OFICIO.
 * Patrones muy específicos (LIBRESE OFICIO) tienen peso alto; los institucionales
 * (BANCO, HOSPITAL) tienen peso bajo porque pueden aparecer en cualquier escrito.
 */
const PATRONES_OFICIO: PatronDef[] = [
  { patron: "OFICIO",              regex: /\bOFICIO\b/u,                                  clasificacion: "OFICIO", peso: 3 },
  { patron: "LIBRESE OFICIO",      regex: /\bL[IÍ]BRESE\s+OFICIO\b/u,                     clasificacion: "OFICIO", peso: 4 },
  { patron: "AL SR",               regex: /\bAL\s+SR\.?\b/u,                              clasificacion: "OFICIO", peso: 2 },
  { patron: "AL SEÑOR",            regex: /\bAL\s+SE[NÑ]OR\b/u,                           clasificacion: "OFICIO", peso: 2 },
  { patron: "AL SEÑOR/A",          regex: /\bAL\s+SE[NÑ]OR\s*\/?\s*A\b/u,                 clasificacion: "OFICIO", peso: 2 },
  { patron: "DIRECTOR",            regex: /\bDIRECTOR(?:A|ES|AS)?\b/u,                    clasificacion: "OFICIO", peso: 1 },
  { patron: "BANCO",               regex: /\bBANCO\b/u,                                   clasificacion: "OFICIO", peso: 1 },
  { patron: "HOSPITAL",            regex: /\bHOSPITAL\b/u,                                clasificacion: "OFICIO", peso: 1 },
  { patron: "REGISTRO",            regex: /\bREGISTRO\s+(?:NACIONAL|CIVIL|DE)\b/u,        clasificacion: "OFICIO", peso: 2 },
  { patron: "AFIP",                regex: /\bAFIP\b/u,                                    clasificacion: "OFICIO", peso: 2 },
  { patron: "ANSES",               regex: /\bANSES\b/u,                                   clasificacion: "OFICIO", peso: 2 },
  { patron: "ARCA",                regex: /\bARCA\b/u,                                    clasificacion: "OFICIO", peso: 2 },
  { patron: "POLICIA FEDERAL",     regex: /\bPOLIC[IÍ]A\s+FEDERAL\b/u,                    clasificacion: "OFICIO", peso: 2 },
  { patron: "REMITASE OFICIO",     regex: /\bREM[ÍI]TASE\s+OFICIO\b/u,                    clasificacion: "OFICIO", peso: 4 },
  { patron: "TENGASE PRESENTE OFICIO", regex: /\bTENGASE\s+PRESENTE\s+EL\s+OFICIO\b/u,    clasificacion: "OFICIO", peso: 3 },
];

/**
 * Patrones CEDULA. Igual lógica de pesos.
 * Los patrones muy específicos del formulario PJN ("CEDULA DE NOTIFICACION",
 * "OFICIAL NOTIFICADOR", "DOMICILIO CONSTITUIDO") son los más confiables.
 */
const PATRONES_CEDULA: PatronDef[] = [
  { patron: "CEDULA",                 regex: /\bC[EÉ]DULA\b/u,                            clasificacion: "CEDULA", peso: 3 },
  { patron: "CEDULA DE NOTIFICACION", regex: /\bC[EÉ]DULA\s+DE\s+NOTIFICAC[IÓO]N\b/u,     clasificacion: "CEDULA", peso: 4 },
  { patron: "NOTIFICACION",           regex: /\bNOTIFICAC[IÓO]N(?:ES)?\b/u,               clasificacion: "CEDULA", peso: 1 },
  { patron: "DOMICILIO CONSTITUIDO",  regex: /\bDOMICILIO\s+CONSTITUIDO\b/u,              clasificacion: "CEDULA", peso: 3 },
  { patron: "OFICIAL NOTIFICADOR",    regex: /\bOFICIAL\s+NOTIFICADOR(?:A)?\b/u,          clasificacion: "CEDULA", peso: 4 },
  { patron: "SE NOTIFICA",            regex: /\bSE\s+(?:LE\s+)?NOTIFICA\b/u,              clasificacion: "CEDULA", peso: 2 },
  { patron: "ZONA",                   regex: /\bZONA\s+N(?:RO|°|º|\.|UMERO)?\s*\d/u,      clasificacion: "CEDULA", peso: 2 },
  { patron: "ART 135 CPCC",           regex: /\bART\.?\s*135\b/u,                         clasificacion: "CEDULA", peso: 2 },
  { patron: "ART 137 CPCC",           regex: /\bART\.?\s*137\b/u,                         clasificacion: "CEDULA", peso: 1 },
  { patron: "CAR. INTERV.",           regex: /\bCAR\.?\s*INTERV\.?\b/u,                   clasificacion: "CEDULA", peso: 2 },
  { patron: "INTERVINIENTE",          regex: /\bINTERVINIENTE\b/u,                        clasificacion: "CEDULA", peso: 1 },
  { patron: "DEPENDENCIA",            regex: /\bDEPENDENCIA\b/u,                          clasificacion: "CEDULA", peso: 1 },
  { patron: "DESTINATARIO",           regex: /\bDESTINATARIO\b/u,                         clasificacion: "CEDULA", peso: 1 },
];

const PATRONES_TODOS: PatronDef[] = [...PATRONES_OFICIO, ...PATRONES_CEDULA];

/**
 * Quita diacríticos para que los patrones funcionen sobre "CÉDULA" o "Cedula".
 * Devuelve una sola línea en mayúsculas.
 */
export function normalizarTextoPdf(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// =============================================================================
// Polyfills DOM mínimos para pdf-parse @ pdfjs-dist@5 en runtime Node (Vercel)
// -----------------------------------------------------------------------------
// pdfjs-dist@5 referencia DOMMatrix, Path2D, ImageData y OffscreenCanvas como
// globals. En Node 20/22 (Vercel) estos no existen y pdf-parse lanza
// "DOMMatrix is not defined" al ejecutar getText() sobre PDFs reales.
//
// Para la extracción de texto NO se requieren las matemáticas reales de estas
// APIs — sólo que las clases existan. Stubs mínimos son suficientes y no
// afectan a ningún otro flujo (no hay otro uso de DOMMatrix en el repo).
// =============================================================================

type PdfPolyfillGlobals = {
  DOMMatrix?: unknown;
  Path2D?: unknown;
  ImageData?: unknown;
  OffscreenCanvas?: unknown;
};

let polyfillsAplicados = false;

function aplicarPdfPolyfills(): void {
  if (polyfillsAplicados) return;
  const g = globalThis as unknown as PdfPolyfillGlobals;

  if (typeof g.DOMMatrix === "undefined") {
    class DOMMatrixStub {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      m11 = 1;
      m12 = 0;
      m13 = 0;
      m14 = 0;
      m21 = 0;
      m22 = 1;
      m23 = 0;
      m24 = 0;
      m31 = 0;
      m32 = 0;
      m33 = 1;
      m34 = 0;
      m41 = 0;
      m42 = 0;
      m43 = 0;
      m44 = 1;
      is2D = true;
      isIdentity = true;
      constructor(_init?: unknown) {
        // Stub: no parsea init real. Sólo expone el shape.
      }
      multiply(_o?: unknown): DOMMatrixStub {
        return this;
      }
      multiplySelf(_o?: unknown): DOMMatrixStub {
        return this;
      }
      preMultiplySelf(_o?: unknown): DOMMatrixStub {
        return this;
      }
      translate(_x?: number, _y?: number): DOMMatrixStub {
        return this;
      }
      translateSelf(_x?: number, _y?: number): DOMMatrixStub {
        return this;
      }
      scale(_x?: number, _y?: number): DOMMatrixStub {
        return this;
      }
      scaleSelf(_x?: number, _y?: number): DOMMatrixStub {
        return this;
      }
      scaleNonUniformSelf(_x?: number, _y?: number): DOMMatrixStub {
        return this;
      }
      rotate(_a?: number): DOMMatrixStub {
        return this;
      }
      rotateSelf(_a?: number): DOMMatrixStub {
        return this;
      }
      rotateFromVectorSelf(_x?: number, _y?: number): DOMMatrixStub {
        return this;
      }
      flipX(): DOMMatrixStub {
        return this;
      }
      flipY(): DOMMatrixStub {
        return this;
      }
      inverse(): DOMMatrixStub {
        return this;
      }
      invertSelf(): DOMMatrixStub {
        return this;
      }
      skewXSelf(_a?: number): DOMMatrixStub {
        return this;
      }
      skewYSelf(_a?: number): DOMMatrixStub {
        return this;
      }
      transformPoint(p?: unknown): unknown {
        return p ?? { x: 0, y: 0, z: 0, w: 1 };
      }
      setMatrixValue(_s?: string): DOMMatrixStub {
        return this;
      }
      toFloat32Array(): Float32Array {
        return new Float32Array(16);
      }
      toFloat64Array(): Float64Array {
        return new Float64Array(16);
      }
      toString(): string {
        return "matrix(1, 0, 0, 1, 0, 0)";
      }
      static fromMatrix(_o?: unknown): DOMMatrixStub {
        return new DOMMatrixStub();
      }
      static fromFloat32Array(_a?: unknown): DOMMatrixStub {
        return new DOMMatrixStub();
      }
      static fromFloat64Array(_a?: unknown): DOMMatrixStub {
        return new DOMMatrixStub();
      }
    }
    g.DOMMatrix = DOMMatrixStub;
  }

  if (typeof g.Path2D === "undefined") {
    class Path2DStub {
      constructor(_init?: unknown) {}
      addPath(_p?: unknown, _t?: unknown): void {}
      closePath(): void {}
      moveTo(_x?: number, _y?: number): void {}
      lineTo(_x?: number, _y?: number): void {}
      bezierCurveTo(): void {}
      quadraticCurveTo(): void {}
      arc(): void {}
      arcTo(): void {}
      ellipse(): void {}
      rect(): void {}
      roundRect(): void {}
    }
    g.Path2D = Path2DStub;
  }

  if (typeof g.ImageData === "undefined") {
    class ImageDataStub {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      colorSpace = "srgb" as const;
      constructor(
        arg1: number | Uint8ClampedArray,
        arg2?: number,
        arg3?: number
      ) {
        if (arg1 instanceof Uint8ClampedArray) {
          this.data = arg1;
          this.width = arg2 ?? 1;
          this.height = arg3 ?? Math.max(1, Math.floor(this.data.length / 4 / this.width));
        } else {
          this.width = arg1;
          this.height = arg2 ?? 1;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        }
      }
    }
    g.ImageData = ImageDataStub;
  }

  if (typeof g.OffscreenCanvas === "undefined") {
    class OffscreenCanvasStub {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(_id?: string): null {
        // No tenemos canvas real; devolver null fuerza a pdfjs a saltar el
        // render path. La extracción de texto no necesita contexto.
        return null;
      }
      transferToImageBitmap(): null {
        return null;
      }
      convertToBlob(): Promise<null> {
        return Promise.resolve(null);
      }
    }
    g.OffscreenCanvas = OffscreenCanvasStub;
  }

  polyfillsAplicados = true;
}

// Aplicamos al cargar el módulo para que ningún consumer tenga que invocarlo.
aplicarPdfPolyfills();

export type ExtraccionResultado =
  | { ok: true; paginas: string[]; texto_concatenado: string }
  | { ok: false; error: string };

/**
 * Extrae el texto de las primeras N páginas del PDF usando pdf-parse@2.x.
 *
 * NUNCA lanza: si la extracción falla devuelve { ok: false, error }.
 * El caller debe decidir cómo reportar (ver /run/route.ts: extracción fallida ⇒
 * clasificación INDETERMINADO con ok:true).
 *
 * Aplica polyfills DOM mínimos en runtime Node antes de cargar pdf-parse.
 */
export async function extraerTextoPdfLocal(
  buf: Buffer,
  maxPages: number = PDF_AUDIT_MAX_PAGES
): Promise<ExtraccionResultado> {
  aplicarPdfPolyfills();
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const result = await parser.getText({ first: maxPages });
      const paginas = result.pages.slice(0, maxPages).map((p) => p.text ?? "");
      const texto_concatenado = paginas.join("\n");
      return { ok: true, paginas, texto_concatenado };
    } finally {
      try {
        await parser.destroy();
      } catch {
        // destroy() puede fallar si el parser nunca abrió el PDF — lo ignoramos
        // a propósito: cualquier error real ya quedó atrapado en el try externo.
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// =============================================================================
// OCR controlado vía microservicio pdf-extractor-service (POST /extract)
// -----------------------------------------------------------------------------
// El microservicio expone:
//   POST {PDF_EXTRACTOR_URL}  con multipart/form-data, campo "file" (PDF)
//   → { caratula, juzgado, raw_preview, debug?: { ocr_used, ... } }
//
// raw_preview = primeros 500 caracteres del texto extraído (pdftotext o
// Tesseract OCR si el PDF es escaneado). Es suficiente para detectar el header
// del documento (CEDULA / OFICIO / etc.) que vive en la primera página.
//
// NO llamamos /procesar ni /procesar-oficio del flujo Railway (esos generan
// PDFs nuevos y mezclan procesamiento; no nos sirven para clasificar).
// =============================================================================

export type FuenteTexto = "local" | "ocr" | "gpt_vision" | "sin_texto";

export type ExtractorResultado =
  | { ok: true; texto: string; texto_chars: number; ocr_used: boolean }
  | { ok: false; error: string };

export type OcrClient = {
  /**
   * Recibe el buffer del PDF y devuelve texto plano (raw_preview + carátula +
   * juzgado, cuando estén disponibles). Nunca lanza: encapsula errores en
   * `{ ok: false, error }`.
   */
  invocar: (buf: Buffer) => Promise<ExtractorResultado>;
};

/**
 * Crea un cliente OCR contra el microservicio pdf-extractor-service.
 * Devuelve null si la env var no está configurada.
 *
 * @deprecated El flujo de auditoría documental ya no usa el microservicio
 *   pdf-extractor-service (Render) — fue reemplazado por GPT Vision a partir
 *   de mayo 2026 porque el microservicio quedó fuera de servicio. Se conserva
 *   este factory por si el microservicio vuelve y se quiere reactivar como
 *   fallback alternativo. El orquestador actual `obtenerClasificacionAuditoria`
 *   NO lo invoca. Para reactivarlo habría que editar el orquestador.
 */
export function createPdfExtractorOcrClient(urlOverride?: string | null): OcrClient | null {
  const url = (urlOverride ?? process.env.PDF_EXTRACTOR_URL ?? "").trim();
  if (!url) return null;

  return {
    async invocar(buf: Buffer): Promise<ExtractorResultado> {
      try {
        const form = new FormData();
        const ab = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength
        ) as ArrayBuffer;
        form.append(
          "file",
          new Blob([ab], { type: "application/pdf" }),
          "audit.pdf"
        );

        const res = await fetch(url, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(PDF_AUDIT_OCR_TIMEOUT_MS),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          return {
            ok: false,
            error: `HTTP ${res.status} ${res.statusText}${
              errBody ? `: ${errBody.slice(0, 200)}` : ""
            }`,
          };
        }

        const json = (await res.json()) as {
          caratula?: string | null;
          juzgado?: string | null;
          raw_preview?: string | null;
          debug?: { ocr_used?: boolean } | null;
          error?: string;
        };

        if (json.error) {
          return { ok: false, error: json.error };
        }

        // El microservicio NO devuelve el texto completo, solo raw_preview (500
        // chars). Componemos un texto con todos los campos para maximizar la
        // superficie del clasificador. Carátula y juzgado son texto adicional
        // significativo (un OFICIO suele tener "OFICIO" o "Líbrese oficio" en
        // el preview; una CEDULA suele tener "CEDULA DE NOTIFICACION").
        const fragments: string[] = [];
        if (json.raw_preview) fragments.push(json.raw_preview);
        if (json.caratula) fragments.push(`Caratula: ${json.caratula}`);
        if (json.juzgado) fragments.push(`Juzgado: ${json.juzgado}`);

        const texto = fragments.join("\n");
        const texto_chars = texto.trim().length;
        const ocr_used = json.debug?.ocr_used === true;

        return { ok: true, texto, texto_chars, ocr_used };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
      }
    },
  };
}

/**
 * Resultado canónico de la fase "obtener texto para clasificar".
 * `paginas` puede ser:
 *   - múltiples páginas (fuente "local", de pdf-parse)
 *   - una sola "página" sintética (fuente "ocr", del extractor)
 *   - vacío (fuente "sin_texto")
 */
export type TextoExtraccion = {
  fuente: FuenteTexto;
  paginas: string[];
  texto_chars: number;
  /** Detalle libre cuando fuente = "sin_texto" o el OCR fue invocado. */
  detalle: string | null;
};

export type ObtenerTextoOptions = {
  /** Si true y la extracción local no da texto útil, invoca el OcrClient. */
  useOcr: boolean;
  /** Cliente OCR. Si null/undefined y useOcr=true, se crea desde env. */
  ocrClient?: OcrClient | null;
};

/**
 * Orquesta extracción local + OCR controlado.
 *
 *   1) intenta pdf-parse local.
 *   2) si `esTextoJudicialUtil(local)` → fuente "local".
 *   3) si no, y use_ocr=true → invoca el OcrClient.
 *      3a) si `esTextoJudicialUtil(ocr)` → fuente "ocr".
 *      3b) si el OCR falla, devuelve XHTML vacío, o texto no judicial →
 *           fuente "sin_texto" (con detalle informativo).
 *   4) si use_ocr=false → fuente "sin_texto".
 *
 * IMPORTANTE: el criterio de "útil" NO es por longitud cruda — el microservicio
 * extractor puede devolver XHTML residual de `pdftotext -bbox` (≥ 300 chars
 * pero vacío de contenido), y los antiguos `>= 30 chars` lo confundían con
 * texto OCR real. Ahora usamos `esTextoJudicialUtil` que descarta XHTML y
 * exige contenido alfabético/judicial mínimo.
 *
 * NUNCA lanza. El caller distingue:
 *   - fuente "local" / "ocr" → clasificar con `clasificarTextoPdf({ paginas })`.
 *   - fuente "sin_texto"    → `clasificacionExtraccionFallida(detalle)`.
 */
export async function obtenerTextoParaAuditoria(
  buf: Buffer,
  opts: ObtenerTextoOptions
): Promise<TextoExtraccion> {
  // 1) Local
  const local = await extraerTextoPdfLocal(buf);
  if (local.ok) {
    const charsLocal = local.texto_concatenado.trim().length;
    if (esTextoJudicialUtil(local.texto_concatenado)) {
      return {
        fuente: "local",
        paginas: local.paginas,
        texto_chars: charsLocal,
        detalle: null,
      };
    }
    if (!opts.useOcr) {
      return {
        fuente: "sin_texto",
        paginas: [],
        texto_chars: charsLocal,
        detalle: `Texto local no es útil judicialmente (${charsLocal} chars crudos); use_ocr=false`,
      };
    }
  } else {
    if (!opts.useOcr) {
      return {
        fuente: "sin_texto",
        paginas: [],
        texto_chars: 0,
        detalle: `Extracción local falló: ${local.error}; use_ocr=false`,
      };
    }
  }

  // 2) OCR remoto
  const client = opts.ocrClient ?? createPdfExtractorOcrClient();
  if (!client) {
    return {
      fuente: "sin_texto",
      paginas: [],
      texto_chars: 0,
      detalle:
        "use_ocr=true pero PDF_EXTRACTOR_URL no está configurada en el entorno",
    };
  }

  const ocr = await client.invocar(buf);
  if (!ocr.ok) {
    return {
      fuente: "sin_texto",
      paginas: [],
      texto_chars: 0,
      detalle: `OCR remoto falló: ${ocr.error}`,
    };
  }

  if (!esTextoJudicialUtil(ocr.texto)) {
    return {
      fuente: "sin_texto",
      // Preservamos texto_chars original para que el operador note que el
      // extractor SÍ devolvió bytes — solo que no es contenido judicial.
      paginas: [],
      texto_chars: ocr.texto_chars,
      detalle: `El extractor devolvió ${ocr.texto_chars} chars sin contenido judicial útil (posible XHTML vacío de pdftotext -bbox; el microservicio no cayó a Tesseract)`,
    };
  }

  return {
    fuente: "ocr",
    paginas: [ocr.texto],
    texto_chars: ocr.texto_chars,
    detalle: ocr.ocr_used
      ? "extractor remoto (pdftotext+tesseract)"
      : "extractor remoto (pdftotext)",
  };
}

// =============================================================================
// GPT Vision: recorte PDF + cliente + orquestador
// =============================================================================

/**
 * Clamp del parámetro `max_pages` recibido del cliente. Rango [1, 5], default 5.
 * Acepta string|number|undefined|null|NaN.
 */
export function parsearMaxPages(raw: unknown): number {
  if (raw == null) return AUDIT_MAX_PAGES_DEFAULT;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return AUDIT_MAX_PAGES_DEFAULT;
  if (n < AUDIT_MAX_PAGES_MIN) return AUDIT_MAX_PAGES_MIN;
  if (n > AUDIT_MAX_PAGES_MAX) return AUDIT_MAX_PAGES_MAX;
  return Math.floor(n);
}

/**
 * Recorta un PDF a las primeras N páginas usando pdf-lib (puro JS, sin
 * binarios). Si el PDF tiene menos páginas que `maxPages`, devuelve todas las
 * disponibles. NUNCA lanza: si pdf-lib rechaza el PDF, retorna error
 * controlado.
 *
 * @returns `{ ok: true, buffer, paginas_enviadas }` o `{ ok: false, error }`.
 */
export async function recortarPdfPrimeraPaginas(
  buf: Buffer,
  maxPages: number
): Promise<
  | { ok: true; buffer: Buffer; paginas_enviadas: number; paginas_totales: number }
  | { ok: false; error: string }
> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    // Importante: pdf-lib rechaza Encrypted PDFs por default; lo permitimos
    // para no fallar con cédulas firmadas. Sin embargo, encrypted=true puede
    // dar páginas con texto en blanco — Vision igual lee la imagen.
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const total = src.getPageCount();
    if (total <= 0) {
      return { ok: false, error: "PDF sin páginas" };
    }
    const take = Math.max(1, Math.min(maxPages, total));
    const out = await PDFDocument.create();
    const indices = Array.from({ length: take }, (_, i) => i);
    const copied = await out.copyPages(src, indices);
    for (const p of copied) out.addPage(p);
    const bytes = await out.save();
    return {
      ok: true,
      buffer: Buffer.from(bytes),
      paginas_enviadas: take,
      paginas_totales: total,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ─── Prompt y schema ─────────────────────────────────────────────────────────

const GPT_VISION_PROMPT = `Sos un clasificador de documentos judiciales argentinos.
Analizá las imágenes del PDF y determiná si el documento completo es una CÉDULA judicial, un OFICIO judicial o INDETERMINADO.

Respondé SOLO JSON válido con este formato:

{
  "tipo_documento": "CEDULA" | "OFICIO" | "INDETERMINADO",
  "confianza": number entre 0 y 1,
  "razones": string[],
  "texto_relevante": string,
  "expediente": string | null,
  "caratula": string | null,
  "juzgado": string | null,
  "destinatario": string | null
}

Criterios de clasificación:
- CEDULA: cédula de notificación, domicilio, notificación, oficial notificador, zona, traslado, se notifica, cédula ley, constancia de diligenciamiento.
- OFICIO: oficio judicial, dirigido a banco, hospital, registro, empleador, organismo, director, entidad, pedido de informe, líbrese oficio, mandamiento/oficio dirigido a tercero institucional.
- INDETERMINADO: si no hay evidencia clara o la imagen no permite leer suficiente.

Reglas:
- No inventes.
- Si no se lee bien, INDETERMINADO.
- No clasifiques por el nombre del archivo.
- No clasifiques por metadatos técnicos.
- Clasificá por contenido visible del documento.
- Si hay varias páginas, evaluá el conjunto.
- "texto_relevante" debe ser breve: solo frases o palabras que justifiquen la clasificación, no transcripción completa.

Metadatos contextuales (para revisión humana, NO para clasificar):
- "expediente": número/identificador del expediente tal como aparece (ej "104277/2026"). Si no se lee, null.
- "caratula": carátula completa o lo más cercano (ej "TAPIA c/ FORNERO s/ DAÑOS"). Si no se lee, null.
- "juzgado": juzgado/tribunal interviniente (ej "JUZGADO NACIONAL EN LO CIVIL N° 1"). Si no se lee, null.
- "destinatario": destinatario del documento (ej "BANCO DE LA NACIÓN ARGENTINA", "Hospital Zubizarreta"). Si no se lee, null.

Reglas para metadatos:
- No inventes. Si dudás, devolvé null en ese campo.
- Devolvé exactamente lo que se lee, sin reformular ni acortar arbitrariamente.
- No incluyas etiquetas como "Expediente:" o "Carátula:" — solo el valor.`;

// ─── Sanitización de campos opcionales del response GPT ──────────────────────

/** Límites de tamaño para metadatos contextuales (defensa en profundidad). */
export const GPT_META_EXPEDIENTE_MAX = 80;
export const GPT_META_CARATULA_MAX = 500;
export const GPT_META_JUZGADO_MAX = 300;
export const GPT_META_DESTINATARIO_MAX = 400;

/**
 * Sanitiza un campo opcional string|null del GPT:
 *  - trim, colapsa espacios.
 *  - rechaza strings vacíos.
 *  - rechaza strings sospechosos ("null", "n/a", "-", etc).
 *  - trunca a `max` chars.
 *
 * Cualquier no-string devuelve null.
 */
export function sanitizarMetaGpt(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length === 0) return null;
  const low = s.toLowerCase();
  if (low === "null" || low === "n/a" || low === "na" || low === "-" || low === "—" || low === "none") {
    return null;
  }
  return s.length > max ? s.slice(0, max) : s;
}

// ─── Tipos del cliente Vision ────────────────────────────────────────────────

export type GptVisionRespuesta = {
  tipo_documento: "CEDULA" | "OFICIO" | "INDETERMINADO";
  confianza: number;
  razones: string[];
  texto_relevante: string;
  /** Metadatos contextuales detectados por GPT, para revisión humana. Null si no se pudo leer. */
  expediente: string | null;
  caratula: string | null;
  juzgado: string | null;
  destinatario: string | null;
};

/** Contexto detectado por GPT Vision (los 4 campos opcionales). */
export type ContextoDetectado = {
  expediente: string | null;
  caratula: string | null;
  juzgado: string | null;
  destinatario: string | null;
};

export type GptVisionResultado =
  | {
      ok: true;
      respuesta: GptVisionRespuesta;
      modelo: string;
    }
  | { ok: false; error: string };

export type GptVisionClient = {
  invocar: (pdfBuf: Buffer, modelo: string) => Promise<GptVisionResultado>;
};

/**
 * Crea un cliente Vision contra la Responses API de OpenAI. Devuelve null si
 * `OPENAI_API_KEY` no está configurada en el entorno.
 *
 * NOTA: La clave es server-side (process.env, jamás expuesta al cliente).
 * NUNCA usar `NEXT_PUBLIC_OPENAI_API_KEY`.
 */
export function createGptVisionClient(): GptVisionClient | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    async invocar(pdfBuf: Buffer, modelo: string): Promise<GptVisionResultado> {
      try {
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey, timeout: AUDIT_GPT_TIMEOUT_MS });

        const b64 = pdfBuf.toString("base64");
        const fileData = `data:application/pdf;base64,${b64}`;

        const response = await client.responses.create({
          model: modelo,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: GPT_VISION_PROMPT },
                {
                  type: "input_file",
                  filename: "documento.pdf",
                  file_data: fileData,
                },
              ],
            },
          ],
          text: { format: { type: "json_object" } },
        });

        const raw = response.output_text ?? "";
        if (!raw) {
          return { ok: false, error: "GPT Vision devolvió respuesta vacía" };
        }

        const parsed = parsearRespuestaGptVision(raw);
        if (!parsed.ok) return parsed;

        return { ok: true, respuesta: parsed.respuesta, modelo };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
      }
    },
  };
}

/**
 * Parsea y valida la respuesta JSON de GPT Vision. Usa `parseVisionOcrJson`
 * (helper existente para reparar JSON roto típico de LLMs) y aplica una
 * validación estricta del shape.
 */
export function parsearRespuestaGptVision(
  raw: string
):
  | { ok: true; respuesta: GptVisionRespuesta }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = parseVisionOcrJson(raw);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `JSON inválido: ${msg}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "respuesta no es un objeto JSON" };
  }

  const o = parsed as Record<string, unknown>;

  const tipoRaw = typeof o.tipo_documento === "string" ? o.tipo_documento.toUpperCase() : "";
  if (tipoRaw !== "CEDULA" && tipoRaw !== "OFICIO" && tipoRaw !== "INDETERMINADO") {
    return {
      ok: false,
      error: `tipo_documento inválido: "${o.tipo_documento ?? ""}"`,
    };
  }

  let confianza = typeof o.confianza === "number" ? o.confianza : NaN;
  if (!Number.isFinite(confianza)) confianza = 0;
  if (confianza < 0) confianza = 0;
  if (confianza > 1) confianza = 1;

  const razones: string[] = Array.isArray(o.razones)
    ? o.razones
        .filter((r): r is string => typeof r === "string")
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .slice(0, 20)
    : [];

  const texto_relevante =
    typeof o.texto_relevante === "string" ? o.texto_relevante : "";

  return {
    ok: true,
    respuesta: {
      tipo_documento: tipoRaw as GptVisionRespuesta["tipo_documento"],
      confianza,
      razones,
      texto_relevante,
      expediente: sanitizarMetaGpt(o.expediente, GPT_META_EXPEDIENTE_MAX),
      caratula: sanitizarMetaGpt(o.caratula, GPT_META_CARATULA_MAX),
      juzgado: sanitizarMetaGpt(o.juzgado, GPT_META_JUZGADO_MAX),
      destinatario: sanitizarMetaGpt(o.destinatario, GPT_META_DESTINATARIO_MAX),
    },
  };
}


// ─── Tipos del orquestador ───────────────────────────────────────────────────

/**
 * Resultado canónico del orquestador de auditoría documental. A diferencia de
 * `TextoExtraccion`, este puede traer la clasificación ya hecha (cuando viene
 * de GPT Vision el modelo decide directamente, no extraemos texto para
 * pasarlo a un clasificador local).
 */
export type ClasificacionAuditoria = {
  fuente: FuenteTexto;
  clasificacion: ClasificacionResultado["clasificacion"];
  confianza: number;
  /** Razones de scoring (CEDULA/OFICIO) + meta (fuente, chars, etc). */
  razones: RazonClasificacion[];
  /** Snippet preview del texto detectado (puede ser local concatenado o texto_relevante). */
  texto_detectado: string | null;
  /** Longitud del texto considerado (local: chars del texto; gpt_vision: chars de texto_relevante). */
  texto_chars: number;
  /** Solo para fuente="gpt_vision". */
  paginas_enviadas: number | null;
  /** Solo para fuente="gpt_vision". */
  max_pages: number | null;
  /** Solo para fuente="gpt_vision": texto_relevante completo del modelo. */
  texto_relevante: string | null;
  /** Modelo usado (gpt_vision) o descriptor de fuente (local/sin_texto). */
  detalle: string | null;
  /**
   * Metadatos contextuales detectados por GPT Vision (cuando aplica).
   * Cuando fuente != "gpt_vision" o GPT no devolvió campos válidos, los 4
   * sub-campos quedan en null. Nunca es null el objeto mismo, para simplificar
   * la UI (siempre puede leer `clas.contexto_detectado.expediente`).
   */
  contexto_detectado: ContextoDetectado;
};

/** Contexto detectado vacío (todos los campos null). Constante reutilizable. */
export const CONTEXTO_DETECTADO_VACIO: ContextoDetectado = {
  expediente: null,
  caratula: null,
  juzgado: null,
  destinatario: null,
};

/**
 * Resultado de priorizar un dato contextual (expediente/carátula/juzgado/
 * destinatario) entre el valor propio de `cedulas` y el detectado por GPT.
 */
export type ResolucionDato = {
  value: string | null;
  fromGpt: boolean;
};

/**
 * Resuelve un dato contextual con prioridad:
 *
 *   A) `propio` (de cedulas/OCR humano) si no es vacío  → fromGpt=false
 *   B) `gpt`    (de contexto_detectado)  si propio vacío → fromGpt=true
 *   C) null si ambos vacíos                              → fromGpt=false
 *
 * Whitespace-only se considera vacío en ambos lados. Tipo pure: ideal para
 * tests y para uso desde la UI sin acoplar a React.
 */
export function resolverDatoConPrioridad(
  propio: string | null | undefined,
  gpt: string | null | undefined
): ResolucionDato {
  const p = typeof propio === "string" ? propio.trim() : "";
  if (p.length > 0) return { value: p, fromGpt: false };
  const g = typeof gpt === "string" ? gpt.trim() : "";
  if (g.length > 0) return { value: g, fromGpt: true };
  return { value: null, fromGpt: false };
}

export type ObtenerClasificacionOptions = {
  /** Si true, intenta GPT Vision cuando local no da texto útil. */
  useOcr: boolean;
  /** Páginas máximas que se envían al modelo Vision. Clamp [1,5]. */
  maxPages?: number;
  /** Modelo OpenAI; default `AUDIT_OPENAI_DEFAULT_MODEL`. */
  modelo?: string;
  /** Cliente Vision inyectable (tests). Si null/undefined, se crea desde env. */
  gptClient?: GptVisionClient | null;
};

/**
 * Orquesta extracción local + GPT Vision (cuando aplica).
 *
 *   1) intenta pdf-parse local.
 *   2) si `esTextoJudicialUtil(local)` → fuente "local" + clasificar con
 *      `clasificarTextoPdf` (igual que antes).
 *   3) si no, y use_ocr=true:
 *      3a) recortar PDF a max_pages con pdf-lib.
 *      3b) invocar GPT Vision client.
 *      3c) éxito → fuente "gpt_vision" + clasificación del modelo.
 *      3d) error / sin API key / JSON inválido → fuente "sin_texto",
 *           INDETERMINADO, ok:true, razón explícita.
 *   4) use_ocr=false → fuente "sin_texto".
 *
 * NUNCA lanza. Único caso de error es el de descarga (manejado por el caller,
 * no por este orquestador).
 */
export async function obtenerClasificacionAuditoria(
  buf: Buffer,
  opts: ObtenerClasificacionOptions
): Promise<ClasificacionAuditoria> {
  const maxPages = parsearMaxPages(opts.maxPages);
  const modelo = (opts.modelo ?? process.env.AUDIT_OPENAI_MODEL ?? "").trim() || AUDIT_OPENAI_DEFAULT_MODEL;

  // 1) Local
  const local = await extraerTextoPdfLocal(buf);
  if (local.ok) {
    const charsLocal = local.texto_concatenado.trim().length;
    if (esTextoJudicialUtil(local.texto_concatenado)) {
      const clas = clasificarTextoPdf({ paginas: local.paginas });
      // Si el clasificador local detectó OFICIO, aplicamos la heurística
      // específica para extraer el destinatario institucional (página 2 →
      // 1 → 3). Solo lo agregamos si pasa el sanitizador.
      let contextoLocal: ContextoDetectado = { ...CONTEXTO_DETECTADO_VACIO };
      if (clas.clasificacion === "OFICIO") {
        const dest = extraerDestinatarioOficioDePaginas(local.paginas);
        const destSan = sanitizarMetaGpt(dest, GPT_META_DESTINATARIO_MAX);
        if (destSan) {
          console.log(
            "[tipo-doc-audit] destinatario extraido:",
            JSON.stringify(destSan)
          );
          contextoLocal = { ...contextoLocal, destinatario: destSan };
        }
      }
      return {
        fuente: "local",
        clasificacion: clas.clasificacion,
        confianza: clas.confianza,
        razones: clas.razones,
        texto_detectado: clas.texto_detectado,
        texto_chars: charsLocal,
        paginas_enviadas: null,
        max_pages: null,
        texto_relevante: null,
        detalle: null,
        contexto_detectado: contextoLocal,
      };
    }
    if (!opts.useOcr) {
      const clas = clasificacionExtraccionFallida(
        `Texto local no es útil judicialmente (${charsLocal} chars); use_ocr=false`
      );
      return {
        fuente: "sin_texto",
        clasificacion: clas.clasificacion,
        confianza: clas.confianza,
        razones: clas.razones,
        texto_detectado: clas.texto_detectado,
        texto_chars: charsLocal,
        paginas_enviadas: null,
        max_pages: null,
        texto_relevante: null,
        detalle: `Texto local no es útil; use_ocr=false`,
        contexto_detectado: { ...CONTEXTO_DETECTADO_VACIO },
      };
    }
  } else {
    if (!opts.useOcr) {
      const clas = clasificacionExtraccionFallida(
        `Extracción local falló: ${local.error}; use_ocr=false`
      );
      return {
        fuente: "sin_texto",
        clasificacion: clas.clasificacion,
        confianza: clas.confianza,
        razones: clas.razones,
        texto_detectado: clas.texto_detectado,
        texto_chars: 0,
        paginas_enviadas: null,
        max_pages: null,
        texto_relevante: null,
        detalle: `Extracción local falló; use_ocr=false`,
        contexto_detectado: { ...CONTEXTO_DETECTADO_VACIO },
      };
    }
  }

  // 2) GPT Vision
  const gptClient = opts.gptClient ?? createGptVisionClient();
  if (!gptClient) {
    const clas = clasificacionExtraccionFallida(
      "OPENAI_API_KEY no configurada"
    );
    return {
      fuente: "sin_texto",
      clasificacion: clas.clasificacion,
      confianza: clas.confianza,
      razones: clas.razones,
      texto_detectado: clas.texto_detectado,
      texto_chars: 0,
      paginas_enviadas: null,
      max_pages: maxPages,
      texto_relevante: null,
      detalle: "OPENAI_API_KEY no configurada",
      contexto_detectado: { ...CONTEXTO_DETECTADO_VACIO },
    };
  }

  // 2.a) Recortar PDF a primeras max_pages
  const recortado = await recortarPdfPrimeraPaginas(buf, maxPages);
  if (!recortado.ok) {
    const clas = clasificacionExtraccionFallida(
      `PDF inválido para recortar: ${recortado.error}`
    );
    return {
      fuente: "sin_texto",
      clasificacion: clas.clasificacion,
      confianza: clas.confianza,
      razones: clas.razones,
      texto_detectado: clas.texto_detectado,
      texto_chars: 0,
      paginas_enviadas: 0,
      max_pages: maxPages,
      texto_relevante: null,
      detalle: `pdf-lib: ${recortado.error}`,
      contexto_detectado: { ...CONTEXTO_DETECTADO_VACIO },
    };
  }

  // 2.b) Llamar GPT Vision
  const gptRes = await gptClient.invocar(recortado.buffer, modelo);

  if (!gptRes.ok) {
    const clas = clasificacionExtraccionFallida(
      `GPT Vision falló o no devolvió JSON válido (${gptRes.error})`
    );
    return {
      fuente: "sin_texto",
      clasificacion: clas.clasificacion,
      confianza: clas.confianza,
      razones: clas.razones,
      texto_detectado: clas.texto_detectado,
      texto_chars: 0,
      paginas_enviadas: recortado.paginas_enviadas,
      max_pages: maxPages,
      texto_relevante: null,
      detalle: `GPT Vision: ${gptRes.error}`,
      contexto_detectado: { ...CONTEXTO_DETECTADO_VACIO },
    };
  }

  // 2.c) Éxito GPT
  const r = gptRes.respuesta;
  const razonesScoring: RazonClasificacion[] = r.razones.map((txt) => ({
    patron: txt.length > 200 ? `${txt.slice(0, 197)}...` : txt,
    clasificacion: r.tipo_documento === "INDETERMINADO" ? null : r.tipo_documento,
    peso: 0,
    pagina: null,
  }));

  // Si GPT clasificó OFICIO, intentamos mejorar el destinatario aplicando la
  // heurística regex sobre `texto_relevante` (que GPT devuelve concatenado).
  // El helper retorna null cuando no encuentra patrón → preservamos el
  // destinatario original de GPT (lógica previa).
  let contextoGpt: ContextoDetectado = {
    expediente: r.expediente,
    caratula: r.caratula,
    juzgado: r.juzgado,
    destinatario: r.destinatario,
  };
  if (r.tipo_documento === "OFICIO") {
    const dest = extraerDestinatarioOficio(r.texto_relevante);
    const destSan = sanitizarMetaGpt(dest, GPT_META_DESTINATARIO_MAX);
    if (destSan) {
      console.log(
        "[tipo-doc-audit] destinatario extraido:",
        JSON.stringify(destSan)
      );
      contextoGpt = { ...contextoGpt, destinatario: destSan };
    }
  }

  return {
    fuente: "gpt_vision",
    clasificacion: r.tipo_documento,
    confianza: r.confianza,
    razones: razonesScoring,
    texto_detectado:
      r.texto_relevante.length > TEXTO_DETECTADO_MAX
        ? r.texto_relevante.slice(0, TEXTO_DETECTADO_MAX)
        : r.texto_relevante,
    texto_chars: r.texto_relevante.length,
    paginas_enviadas: recortado.paginas_enviadas,
    max_pages: maxPages,
    texto_relevante: r.texto_relevante,
    detalle: `modelo=${gptRes.modelo}`,
    contexto_detectado: contextoGpt,
  };
}

/**
 * Razones meta extendidas con info de GPT Vision (paginas_enviadas, max_pages).
 * Compatible con `razonesMetaDeFuente` para fuentes "local"/"ocr"/"sin_texto".
 */
export function razonesMetaDeClasificacion(
  c: ClasificacionAuditoria
): RazonClasificacion[] {
  const out: RazonClasificacion[] = [
    {
      patron: `Fuente texto: ${c.fuente}`,
      clasificacion: null,
      peso: 0,
      pagina: null,
    },
    {
      patron: `Texto chars: ${c.texto_chars}`,
      clasificacion: null,
      peso: 0,
      pagina: null,
    },
  ];
  if (c.fuente === "gpt_vision") {
    if (c.paginas_enviadas != null) {
      out.push({
        patron: `Páginas enviadas: ${c.paginas_enviadas}`,
        clasificacion: null,
        peso: 0,
        pagina: null,
      });
    }
    if (c.max_pages != null) {
      out.push({
        patron: `Max pages: ${c.max_pages}`,
        clasificacion: null,
        peso: 0,
        pagina: null,
      });
    }
    // Contexto detectado por GPT: lo persistimos como meta-razones para
    // poder reconstruirlo desde el JSONB (sin migración). Cada campo va con
    // prefijo "GPT <campo>: <valor>". sanitizarMetaGpt ya truncó las longitudes
    // razonables, así que estos strings no explotan la fila.
    if (c.contexto_detectado.expediente) {
      out.push({
        patron: `GPT expediente: ${c.contexto_detectado.expediente}`,
        clasificacion: null,
        peso: 0,
        pagina: null,
      });
    }
    if (c.contexto_detectado.caratula) {
      out.push({
        patron: `GPT caratula: ${c.contexto_detectado.caratula}`,
        clasificacion: null,
        peso: 0,
        pagina: null,
      });
    }
    if (c.contexto_detectado.juzgado) {
      out.push({
        patron: `GPT juzgado: ${c.contexto_detectado.juzgado}`,
        clasificacion: null,
        peso: 0,
        pagina: null,
      });
    }
    if (c.contexto_detectado.destinatario) {
      out.push({
        patron: `GPT destinatario: ${c.contexto_detectado.destinatario}`,
        clasificacion: null,
        peso: 0,
        pagina: null,
      });
    }
  }
  if (c.detalle) {
    out.push({
      patron: `Detalle fuente: ${c.detalle}`,
      clasificacion: null,
      peso: 0,
      pagina: null,
    });
  }
  return out;
}

/**
 * Construye razones meta (sin peso) para preservar trazabilidad en el JSONB
 * `cedulas_tipo_documento_pdf_audit.razones`.
 */
export function razonesMetaDeFuente(
  fuente: FuenteTexto,
  texto_chars: number,
  detalle?: string | null
): RazonClasificacion[] {
  const razones: RazonClasificacion[] = [
    {
      patron: `Fuente texto: ${fuente}`,
      clasificacion: null,
      peso: 0,
      pagina: null,
    },
    {
      patron: `Texto chars: ${texto_chars}`,
      clasificacion: null,
      peso: 0,
      pagina: null,
    },
  ];
  if (detalle) {
    razones.push({
      patron: `Detalle fuente: ${detalle}`,
      clasificacion: null,
      peso: 0,
      pagina: null,
    });
  }
  return razones;
}

/**
 * Largo máximo del `debug_text` expuesto en la respuesta de /run cuando se pide
 * el modo diagnóstico. NUNCA se persiste; sólo viaja en la respuesta HTTP a un
 * superadmin con `dry_run=true&debug_text=true`.
 */
export const PDF_AUDIT_DEBUG_TEXT_MAX = 1000;

/**
 * Sanitiza una muestra de texto extraído (local o OCR) para exponerla como
 * `debug_text` en la respuesta del endpoint /run. Reglas:
 *
 *   - Reemplaza CR/CRLF por LF.
 *   - Colapsa runs de 3+ saltos consecutivos en 2 (preserva separación de
 *     párrafos pero corta espacios verticales artificiales del OCR).
 *   - Colapsa runs de espacios/tabs en un solo espacio.
 *   - Trim global.
 *   - Trunca a `max` caracteres y, si hay corte, sufija " …[truncado]".
 *
 * Devuelve también `debug_text_chars_originales` = longitud del texto post-join
 * pero pre-sanitización. Útil para diagnosticar cuánto texto recibió la
 * clasificación en total versus cuánto se muestra.
 *
 * El método es seguro frente a `texto` undefined/null (devuelve cadena vacía).
 */
export function sanitizarTextoParaDebug(
  texto: string | null | undefined,
  max: number = PDF_AUDIT_DEBUG_TEXT_MAX
): { debug_text: string; debug_text_chars_originales: number } {
  const original = typeof texto === "string" ? texto : "";
  const originalChars = original.length;

  if (originalChars === 0) {
    return { debug_text: "", debug_text_chars_originales: 0 };
  }

  let s = original.replace(/\r\n?/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  // Whitespace horizontal: espacios, tabs y unicode whitespace excepto \n.
  s = s.replace(/[^\S\n]{2,}/g, " ");
  s = s.trim();

  const limite = Math.max(1, Math.floor(max));
  if (s.length > limite) {
    s = s.slice(0, limite) + " …[truncado]";
  }

  return { debug_text: s, debug_text_chars_originales: originalChars };
}

/**
 * Helpers para parsear las razones meta desde un registro persistido.
 * Útil para /list/route.ts y la UI (compatibilidad con razones legadas).
 */
const RE_FUENTE = /^Fuente texto:\s*(local|ocr|gpt_vision|sin_texto)\s*$/i;
const RE_CHARS = /^Texto chars:\s*(\d+)\s*$/i;
const RE_GPT_EXPEDIENTE = /^GPT expediente:\s*(.+?)\s*$/i;
const RE_GPT_CARATULA = /^GPT caratula:\s*(.+?)\s*$/i;
const RE_GPT_JUZGADO = /^GPT juzgado:\s*(.+?)\s*$/i;
const RE_GPT_DESTINATARIO = /^GPT destinatario:\s*(.+?)\s*$/i;

export function leerFuenteDeRazones(
  razones: unknown
): { fuente_texto: FuenteTexto | null; texto_chars: number | null } {
  if (!Array.isArray(razones)) return { fuente_texto: null, texto_chars: null };

  let fuente_texto: FuenteTexto | null = null;
  let texto_chars: number | null = null;

  for (const raw of razones) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { patron?: unknown };
    if (typeof r.patron !== "string") continue;

    const mFuente = RE_FUENTE.exec(r.patron);
    if (mFuente) {
      const v = mFuente[1].toLowerCase();
      if (v === "local" || v === "ocr" || v === "gpt_vision" || v === "sin_texto") {
        fuente_texto = v;
      }
      continue;
    }
    const mChars = RE_CHARS.exec(r.patron);
    if (mChars) {
      const n = parseInt(mChars[1], 10);
      if (Number.isFinite(n)) texto_chars = n;
    }
  }

  return { fuente_texto, texto_chars };
}

/**
 * Reconstruye el `contexto_detectado` (los 4 campos opcionales de GPT) desde
 * el JSONB `razones` persistido por /run. Si las razones no contienen alguno
 * de los campos meta GPT, ese campo queda en null.
 *
 * Es tolerante a:
 *  - razones que no son array (devuelve todo null).
 *  - entries inválidos (los ignora).
 *  - registros viejos sin "GPT *" (todos null).
 *
 * Pareja simétrica de `razonesMetaDeClasificacion` para fuente "gpt_vision".
 */
export function leerContextoDeRazones(razones: unknown): ContextoDetectado {
  const out: ContextoDetectado = { ...CONTEXTO_DETECTADO_VACIO };
  if (!Array.isArray(razones)) return out;

  for (const raw of razones) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { patron?: unknown };
    if (typeof r.patron !== "string") continue;

    const mE = RE_GPT_EXPEDIENTE.exec(r.patron);
    if (mE) {
      out.expediente = sanitizarMetaGpt(mE[1], GPT_META_EXPEDIENTE_MAX);
      continue;
    }
    const mC = RE_GPT_CARATULA.exec(r.patron);
    if (mC) {
      out.caratula = sanitizarMetaGpt(mC[1], GPT_META_CARATULA_MAX);
      continue;
    }
    const mJ = RE_GPT_JUZGADO.exec(r.patron);
    if (mJ) {
      out.juzgado = sanitizarMetaGpt(mJ[1], GPT_META_JUZGADO_MAX);
      continue;
    }
    const mD = RE_GPT_DESTINATARIO.exec(r.patron);
    if (mD) {
      out.destinatario = sanitizarMetaGpt(mD[1], GPT_META_DESTINATARIO_MAX);
      continue;
    }
  }
  return out;
}

/**
 * Clasifica una página individual (texto plano) buscando patrones.
 * Devuelve los matches encontrados con el peso correspondiente.
 */
function detectarPatronesEnPagina(
  textoNormalizado: string,
  pagina: number | null
): RazonClasificacion[] {
  const razones: RazonClasificacion[] = [];
  for (const def of PATRONES_TODOS) {
    if (def.regex.test(textoNormalizado)) {
      razones.push({
        patron: def.patron,
        clasificacion: def.clasificacion,
        peso: def.peso,
        pagina,
      });
    }
  }
  return razones;
}

/**
 * Clasifica el texto de un PDF. Función pura: ideal para tests unitarios.
 *
 * Estrategia:
 *   - Analiza por página y agrega.
 *   - Suma pesos por clasificación (CEDULA vs OFICIO).
 *   - Si una clasificación supera a la otra por >= 1 punto neto, gana.
 *   - Si empata o no hay matches → INDETERMINADO.
 *   - Confianza = min(1, (pesoGanador - pesoPerdedor) / CONFIANZA_COTA).
 */
export function clasificarTextoPdf(input: {
  paginas: string[];
}): ClasificacionResultado {
  const razones: RazonClasificacion[] = [];

  for (let i = 0; i < input.paginas.length; i++) {
    const normalizado = normalizarTextoPdf(input.paginas[i] ?? "");
    if (!normalizado) continue;
    razones.push(...detectarPatronesEnPagina(normalizado, i + 1));
  }

  // Si nunca pasó por paginas (caso de un solo string sin paginar), seguimos.
  if (input.paginas.length === 0) {
    return {
      clasificacion: "INDETERMINADO",
      confianza: 0,
      razones: [],
      texto_detectado: "",
    };
  }

  const pesoCedula = razones
    .filter((r) => r.clasificacion === "CEDULA")
    .reduce((acc, r) => acc + r.peso, 0);
  const pesoOficio = razones
    .filter((r) => r.clasificacion === "OFICIO")
    .reduce((acc, r) => acc + r.peso, 0);

  let clasificacion: ClasificacionPdf;
  let diff = 0;
  if (pesoCedula === 0 && pesoOficio === 0) {
    clasificacion = "INDETERMINADO";
  } else if (pesoOficio > pesoCedula) {
    clasificacion = "OFICIO";
    diff = pesoOficio - pesoCedula;
  } else if (pesoCedula > pesoOficio) {
    clasificacion = "CEDULA";
    diff = pesoCedula - pesoOficio;
  } else {
    clasificacion = "INDETERMINADO";
  }

  const confianza = clasificacion === "INDETERMINADO"
    ? 0
    : Math.min(1, diff / CONFIANZA_COTA);

  const texto_detectado = input.paginas
    .join("\n")
    .slice(0, TEXTO_DETECTADO_MAX);

  return {
    clasificacion,
    confianza: Number(confianza.toFixed(4)),
    razones: razones.slice(0, RAZONES_MAX),
    texto_detectado,
  };
}

/**
 * Versión por conveniencia para tests: acepta un único string sin paginar
 * y lo trata como una sola página.
 */
export function clasificarTextoPdfDesdeString(texto: string): ClasificacionResultado {
  return clasificarTextoPdf({ paginas: [texto] });
}

// =============================================================================
// Auth helper (reusa el de ocr-oficio-historico para superadmin)
// =============================================================================

export async function requireSuperadmin(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_superadmin === true;
}

// =============================================================================
// Selección de candidatos
// =============================================================================

export type CedulaCandidato = {
  id: string;
  tipo_documento: string | null;
  pdf_path: string | null;
  ocr_caratula: string | null;
  ocr_destinatario: string | null;
  pdf_acredita_url: string | null;
  estado_ocr: string | null;
  pjn_cargado_at: string | null;
  caratula: string | null;
  juzgado: string | null;
  ocr_exp_nro: string | null;
};

const COLS_CANDIDATO =
  "id, tipo_documento, pdf_path, pdf_acredita_url, estado_ocr, pjn_cargado_at, caratula, juzgado, ocr_exp_nro, ocr_caratula, ocr_destinatario";

export type FetchCandidatosOptions = {
  ids?: string[];
};

export type CandidatosBreakdown = {
  total: number;
  con_pdf: number;
  sin_pdf: number;
  por_tipo_actual: {
    CEDULA: number;
    OFICIO: number;
    NULL: number;
    OTROS: number;
  };
};

export function calcularBreakdown(rows: CedulaCandidato[]): CandidatosBreakdown {
  const breakdown: CandidatosBreakdown = {
    total: rows.length,
    con_pdf: 0,
    sin_pdf: 0,
    por_tipo_actual: { CEDULA: 0, OFICIO: 0, NULL: 0, OTROS: 0 },
  };
  for (const r of rows) {
    if (r.pdf_path?.trim()) {
      breakdown.con_pdf++;
    } else {
      breakdown.sin_pdf++;
    }
    if (r.tipo_documento === "CEDULA") breakdown.por_tipo_actual.CEDULA++;
    else if (r.tipo_documento === "OFICIO") breakdown.por_tipo_actual.OFICIO++;
    else if (r.tipo_documento == null || r.tipo_documento === "")
      breakdown.por_tipo_actual.NULL++;
    else breakdown.por_tipo_actual.OTROS++;
  }
  return breakdown;
}

/**
 * Devuelve todos los registros candidatos a ser auditados. Por defecto:
 *   - cualquier cédula con pdf_path no vacío (universo total)
 *   - filtro adicional por ids[] si se provee
 *
 * No filtra por tipo_documento — auditar también NULL y CEDULA mal clasificadas
 * es parte del objetivo.
 */
export async function fetchCandidatosAuditoriaPdf(
  svc: ReturnType<typeof supabaseService>,
  opts: FetchCandidatosOptions = {}
): Promise<{ ok: true; candidatos: CedulaCandidato[] } | { ok: false; error: string }> {
  let query = svc.from("cedulas").select(COLS_CANDIDATO);

  if (opts.ids?.length) {
    query = query.in("id", opts.ids);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(5000);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, candidatos: (data ?? []) as CedulaCandidato[] };
}

/**
 * Devuelve el conjunto de `cedula_id` que ya tienen al menos una fila en
 * `cedulas_tipo_documento_pdf_audit`. Se usa para evitar re-procesar las
 * mismas cédulas en ejecuciones consecutivas del orquestador.
 *
 * Solo lectura. No modifica `cedulas` ni la tabla de auditoría.
 *
 * @returns Set de UUIDs de cedulas auditadas, o error de SELECT.
 */
export async function fetchCedulaIdsYaAuditados(
  svc: ReturnType<typeof supabaseService>
): Promise<{ ok: true; ids: Set<string> } | { ok: false; error: string }> {
  const { data, error } = await svc
    .from("cedulas_tipo_documento_pdf_audit")
    .select("cedula_id");

  if (error) {
    return { ok: false, error: error.message };
  }

  const ids = new Set<string>();
  for (const row of (data ?? []) as { cedula_id: string | null }[]) {
    if (row.cedula_id) ids.add(row.cedula_id);
  }
  return { ok: true, ids };
}

// =============================================================================
// Descarga de PDF desde Storage (sin tocar Storage; sólo lectura)
// =============================================================================

export async function descargarPdfDesdeStorage(
  svc: ReturnType<typeof supabaseService>,
  pdfPath: string
): Promise<
  | { ok: true; buffer: Buffer; archivo_origen: string }
  | { ok: false; error: string }
> {
  const { data, error } = await svc.storage.from(STORAGE_BUCKET).download(pdfPath);
  if (error) return { ok: false, error: error.message };
  if (!data || (data.size ?? 0) <= 0) {
    return { ok: false, error: "Archivo vacío o no encontrado" };
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  return { ok: true, buffer, archivo_origen: `${STORAGE_BUCKET}://${pdfPath}` };
}

// =============================================================================
// FASE 7 — APPLY (NO IMPLEMENTAR EN ESTE PR)
// =============================================================================
//
// TODO(Fase 7): exponer POST /api/admin/auditoria-tipo-documento-pdf/apply
//   - Recibir ids[] de cedulas_tipo_documento_pdf_audit a aplicar.
//   - Validar que clasificacion_pdf ∈ {CEDULA, OFICIO} (NO INDETERMINADO).
//   - Snapshot {tipo_documento: <actual>} → rollback_data.
//   - UPDATE cedulas SET tipo_documento = clasificacion_pdf.
//   - Marcar aplicado=true, aplicado_at=now() en audit.
//   - Confirmación fuerte (2 pasos), logueo [tipo-doc-audit][apply].
//   - Rollback inverso: UPDATE cedulas SET tipo_documento = rollback_data->>'tipo_documento'.
//
// Por ahora: este endpoint NO existe, no se referencia desde UI ni se llama.
// =============================================================================
