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
 * Cota usada para normalizar la confianza a [0,1].
 * Empíricamente: ~3 patrones medianos dominantes ⇒ confianza 1.0.
 */
const CONFIANZA_COTA = 9;

export type ClasificacionPdf = "CEDULA" | "OFICIO" | "INDETERMINADO";

export type RazonClasificacion = {
  patron: string;
  clasificacion: "CEDULA" | "OFICIO";
  peso: number;
  pagina: number | null;
};

export type ClasificacionResultado = {
  clasificacion: ClasificacionPdf;
  confianza: number;
  razones: RazonClasificacion[];
  texto_detectado: string;
};

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

/**
 * Extrae el texto de las primeras N páginas del PDF usando pdf-parse@2.x.
 * Lo usa preview (verificación) y run (clasificación).
 */
export async function extraerTextoPdfLocal(
  buf: Buffer,
  maxPages: number = PDF_AUDIT_MAX_PAGES
): Promise<{ paginas: string[]; texto_concatenado: string }> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText({ first: maxPages });
    const paginas = result.pages.slice(0, maxPages).map((p) => p.text ?? "");
    const texto_concatenado = paginas.join("\n");
    return { paginas, texto_concatenado };
  } finally {
    await parser.destroy();
  }
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
