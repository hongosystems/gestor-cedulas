import { supabaseService } from "@/lib/supabase-server";

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
 * Umbral en caracteres a partir del cual el texto extraído se considera "útil"
 * para clasificación. Alineado con el microservicio extractor (que activa OCR
 * internamente cuando pdftotext devuelve menos de ~100 chars; nosotros somos
 * más permisivos: con 30 chars normalizados ya suele alcanzar el header
 * "CEDULA DE NOTIFICACION" o "OFICIO").
 */
export const PDF_AUDIT_TEXTO_MIN_UTIL = 30;
/**
 * Timeout para llamadas al microservicio pdf-extractor-service. El microservicio
 * cancela a los 28s (ENDPOINT_TIMEOUT), así que dejamos margen para el handshake.
 */
export const PDF_AUDIT_OCR_TIMEOUT_MS = 35_000;

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

export type FuenteTexto = "local" | "ocr" | "sin_texto";

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
 * `urlOverride` permite inyectar URL para tests (no es lo común — los tests
 * usan un OcrClient totalmente mock vía inyección).
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
  /** Umbral de chars para considerar el texto "útil" (default PDF_AUDIT_TEXTO_MIN_UTIL). */
  umbralUtil?: number;
};

/**
 * Orquesta extracción local + OCR controlado.
 *
 *   1) intenta pdf-parse local.
 *   2) si la longitud (trimmed) >= umbral → fuente "local".
 *   3) si no, y use_ocr=true → invoca el OcrClient.
 *      3a) si el OCR devuelve texto >= umbral → fuente "ocr".
 *      3b) si el OCR falla o devuelve texto corto → fuente "sin_texto".
 *   4) si use_ocr=false → fuente "sin_texto".
 *
 * NUNCA lanza. El caller distingue:
 *   - fuente "local" / "ocr" → clasificar con `clasificarTextoPdf({ paginas })`.
 *   - fuente "sin_texto"    → `clasificacionExtraccionFallida(detalle)`.
 */
export async function obtenerTextoParaAuditoria(
  buf: Buffer,
  opts: ObtenerTextoOptions
): Promise<TextoExtraccion> {
  const umbral = opts.umbralUtil ?? PDF_AUDIT_TEXTO_MIN_UTIL;

  // 1) Local
  const local = await extraerTextoPdfLocal(buf);
  if (local.ok) {
    const charsLocal = local.texto_concatenado.trim().length;
    if (charsLocal >= umbral) {
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
        detalle: `Texto local insuficiente (${charsLocal} chars; umbral ${umbral}); use_ocr=false`,
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

  if (ocr.texto_chars < umbral) {
    return {
      fuente: "sin_texto",
      paginas: [],
      texto_chars: ocr.texto_chars,
      detalle: `OCR devolvió texto insuficiente (${ocr.texto_chars} chars; umbral ${umbral})`,
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
 * Helpers para parsear las razones meta desde un registro persistido.
 * Útil para /list/route.ts y la UI (compatibilidad con razones legadas).
 */
const RE_FUENTE = /^Fuente texto:\s*(local|ocr|sin_texto)\s*$/i;
const RE_CHARS = /^Texto chars:\s*(\d+)\s*$/i;

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
      if (v === "local" || v === "ocr" || v === "sin_texto") {
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
  pdf_acredita_url: string | null;
  estado_ocr: string | null;
  pjn_cargado_at: string | null;
  caratula: string | null;
  juzgado: string | null;
  ocr_exp_nro: string | null;
};

const COLS_CANDIDATO =
  "id, tipo_documento, pdf_path, pdf_acredita_url, estado_ocr, pjn_cargado_at, caratula, juzgado, ocr_exp_nro";

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
