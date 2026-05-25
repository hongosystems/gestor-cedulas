import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  RAZONES_MAX,
  clasificacionExtraccionFallida,
  clasificarTextoPdf,
  descargarPdfDesdeStorage,
  fetchCandidatosAuditoriaPdf,
  obtenerTextoParaAuditoria,
  razonesMetaDeFuente,
  requireSuperadmin,
  type CedulaCandidato,
  type ClasificacionResultado,
  type FuenteTexto,
  type OcrClient,
} from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";
export const maxDuration = 300;

const LIMIT_DEFAULT = 5;
const LIMIT_MAX = 10;

type RunBody = {
  limit?: number;
  dry_run?: boolean;
  only_mismatches?: boolean;
  ids?: string[];
  use_ocr?: boolean;
};

type RunItemResult = {
  cedula_id: string;
  ok: boolean;
  tipo_documento_actual: string | null;
  clasificacion_pdf: ClasificacionResultado["clasificacion"] | null;
  confianza: number | null;
  razones_count: number;
  audit_id: string | null;
  /** true si tipo_documento_actual != clasificacion_pdf (excluye INDETERMINADO). */
  mismatch: boolean;
  fuente_texto: FuenteTexto;
  texto_chars: number;
  error: string | null;
};

function parseLimit(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (Number.isNaN(n) || n < 1) return LIMIT_DEFAULT;
  return Math.min(n, LIMIT_MAX);
}

function parseBool(v: unknown, defaultValue: boolean): boolean {
  if (v === undefined || v === null || v === "") return defaultValue;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return defaultValue;
}

function parseIds(v: unknown): string[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof v === "string") {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

async function parseRunParams(req: NextRequest): Promise<{
  limit: number;
  dryRun: boolean;
  onlyMismatches: boolean;
  useOcr: boolean;
  ids?: string[];
}> {
  const url = req.nextUrl.searchParams;
  let limit = parseLimit(url.get("limit"));
  let dryRun = parseBool(url.get("dry_run"), true);
  let onlyMismatches = parseBool(url.get("only_mismatches"), false);
  let useOcr = parseBool(url.get("use_ocr"), false);
  let ids = parseIds(url.get("ids"));

  try {
    const body = (await req.json()) as RunBody | null;
    if (body && typeof body === "object") {
      if ("limit" in body) limit = parseLimit(body.limit);
      if ("dry_run" in body) dryRun = parseBool(body.dry_run, true);
      if ("only_mismatches" in body)
        onlyMismatches = parseBool(body.only_mismatches, false);
      if ("use_ocr" in body) useOcr = parseBool(body.use_ocr, false);
      if ("ids" in body) ids = parseIds(body.ids);
    }
  } catch {
    /* body vacío o no JSON: usar query */
  }

  return { limit, dryRun, onlyMismatches, useOcr, ids };
}

function calcularMismatch(
  tipoActual: string | null,
  clasificacion: ClasificacionResultado["clasificacion"]
): boolean {
  if (clasificacion === "INDETERMINADO") return false;
  if (tipoActual == null || tipoActual === "") return true; // NULL vs (CEDULA|OFICIO) = mismatch
  return tipoActual !== clasificacion;
}

/**
 * POST /api/admin/auditoria-tipo-documento-pdf/run
 *
 * Solo superadmin.
 * Lee PDFs y clasifica. No modifica cedulas. No toca Storage.
 *
 * Parámetros (query o JSON):
 *   - limit (default 5, max 10)
 *   - dry_run (default true)
 *   - only_mismatches (opcional, filtra el universo a aquellos donde
 *       tipo_documento NO coincide con tipo detectado por nombre/heurística previa.
 *       En este endpoint se interpreta como: "calcular y guardar solo si la
 *       clasificación difiere de tipo_documento_actual".)
 *   - ids[] (opcional, IDs específicos a auditar)
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede ejecutar la auditoría de tipo documento por PDF" },
      { status: 403 }
    );
  }

  const { limit, dryRun, onlyMismatches, useOcr, ids } = await parseRunParams(req);

  console.log("[tipo-doc-audit][run] inicio", {
    userId: user.id,
    limit,
    dryRun,
    onlyMismatches,
    useOcr,
    idsCount: ids?.length ?? 0,
  });

  if (useOcr && !process.env.PDF_EXTRACTOR_URL?.trim()) {
    console.warn(
      "[tipo-doc-audit][run] use_ocr=true pero PDF_EXTRACTOR_URL no está configurada — todos los ítems quedarán como sin_texto"
    );
  }

  const fetchResult = await fetchCandidatosAuditoriaPdf(svc, { ids });
  if (!fetchResult.ok) {
    console.error("[tipo-doc-audit][run] error al listar candidatos:", fetchResult.error);
    return NextResponse.json(
      { error: "Error al listar candidatos", details: fetchResult.error },
      { status: 500 }
    );
  }

  // Sólo procesamos los que tienen pdf_path. Sin PDF no hay nada que clasificar.
  const conPdf = fetchResult.candidatos.filter((c) => !!c.pdf_path?.trim());
  const lote = conPdf.slice(0, limit);
  const resultados: RunItemResult[] = [];

  for (const cedula of lote) {
    const resultado = await procesarCedula(svc, cedula, {
      dryRun,
      onlyMismatches,
      useOcr,
      userId: user.id,
    });
    resultados.push(resultado);
  }

  const exitosos = resultados.filter((r) => r.ok).length;
  const fallidos = resultados.filter((r) => !r.ok).length;
  const inconsistencias = resultados.filter((r) => r.mismatch).length;
  const porFuente = {
    local: resultados.filter((r) => r.fuente_texto === "local").length,
    ocr: resultados.filter((r) => r.fuente_texto === "ocr").length,
    sin_texto: resultados.filter((r) => r.fuente_texto === "sin_texto").length,
  };

  console.log("[tipo-doc-audit][run] fin", {
    userId: user.id,
    procesados: lote.length,
    exitosos,
    fallidos,
    inconsistencias,
    porFuente,
    dryRun,
    useOcr,
  });

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    only_mismatches: onlyMismatches,
    use_ocr: useOcr,
    generated_at: new Date().toISOString(),
    nota: dryRun
      ? "dry_run=true: se clasificaron PDFs pero NO se insertó en cedulas_tipo_documento_pdf_audit. Enviar dry_run=false para persistir."
      : "Auditoría persistida en cedulas_tipo_documento_pdf_audit. No se modificó cedulas.tipo_documento ni Storage.",
    parametros: {
      limit,
      dry_run: dryRun,
      only_mismatches: onlyMismatches,
      use_ocr: useOcr,
      limit_max: LIMIT_MAX,
    },
    universo_con_pdf: conPdf.length,
    procesados_en_esta_llamada: lote.length,
    pendientes_restantes: Math.max(0, conPdf.length - lote.length),
    exitosos,
    fallidos,
    inconsistencias,
    por_fuente_texto: porFuente,
    resultados,
  });
}

type ProcesarOpts = {
  dryRun: boolean;
  onlyMismatches: boolean;
  useOcr: boolean;
  userId: string;
  /** Opcional: cliente OCR inyectable (tests). En producción se construye desde env. */
  ocrClient?: OcrClient | null;
};

async function procesarCedula(
  svc: ReturnType<typeof supabaseService>,
  cedula: CedulaCandidato,
  opts: ProcesarOpts
): Promise<RunItemResult> {
  const { dryRun, onlyMismatches, useOcr, userId, ocrClient } = opts;

  const pdfPath = cedula.pdf_path?.trim();
  if (!pdfPath) {
    return {
      cedula_id: cedula.id,
      ok: false,
      tipo_documento_actual: cedula.tipo_documento,
      clasificacion_pdf: null,
      confianza: null,
      razones_count: 0,
      audit_id: null,
      mismatch: false,
      fuente_texto: "sin_texto",
      texto_chars: 0,
      error: "pdf_path vacío",
    };
  }

  // 1) Descargar PDF (sin tocar Storage). Único caso que genera ok:false.
  const downloadResult = await descargarPdfDesdeStorage(svc, pdfPath);
  if (!downloadResult.ok) {
    console.warn("[tipo-doc-audit][run] error de descarga", {
      cedula_id: cedula.id,
      pdf_path: pdfPath,
      error: downloadResult.error,
    });
    return {
      cedula_id: cedula.id,
      ok: false,
      tipo_documento_actual: cedula.tipo_documento,
      clasificacion_pdf: null,
      confianza: null,
      razones_count: 0,
      audit_id: null,
      mismatch: false,
      fuente_texto: "sin_texto",
      texto_chars: 0,
      error: `No se pudo descargar PDF: ${downloadResult.error}`,
    };
  }

  // 2) Obtener texto: local primero; si no es útil y useOcr=true, OCR controlado
  //    vía pdf-extractor-service. Nunca lanza.
  const texto = await obtenerTextoParaAuditoria(downloadResult.buffer, {
    useOcr,
    ocrClient: ocrClient ?? undefined,
  });

  console.log("[tipo-doc-audit][run] texto obtenido", {
    cedula_id: cedula.id,
    fuente_texto: texto.fuente,
    texto_chars: texto.texto_chars,
    detalle: texto.detalle,
    useOcr,
  });

  // 3) Clasificar
  let clasificado: ClasificacionResultado;
  if (texto.fuente === "sin_texto") {
    clasificado = clasificacionExtraccionFallida(
      texto.detalle ?? "No se pudo extraer texto del PDF"
    );
  } else {
    clasificado = clasificarTextoPdf({ paginas: texto.paginas });
  }

  // 4) Adjuntar meta-razones de trazabilidad de fuente y longitud.
  //    Se prependen para que sean fáciles de leer en la UI.
  const razonesMeta = razonesMetaDeFuente(
    texto.fuente,
    texto.texto_chars,
    texto.detalle
  );
  const razonesCompletas = [...razonesMeta, ...clasificado.razones].slice(
    0,
    RAZONES_MAX
  );

  const mismatch = calcularMismatch(cedula.tipo_documento, clasificado.clasificacion);

  console.log("[tipo-doc-audit][classification]", {
    cedula_id: cedula.id,
    tipo_documento_actual: cedula.tipo_documento,
    clasificacion_pdf: clasificado.clasificacion,
    confianza: clasificado.confianza,
    razones_count: razonesCompletas.length,
    fuente_texto: texto.fuente,
    texto_chars: texto.texto_chars,
    mismatch,
  });

  // 5) Persistir (sólo si dry_run=false y, si only_mismatches, sólo si hay mismatch)
  if (dryRun) {
    return {
      cedula_id: cedula.id,
      ok: true,
      tipo_documento_actual: cedula.tipo_documento,
      clasificacion_pdf: clasificado.clasificacion,
      confianza: clasificado.confianza,
      razones_count: razonesCompletas.length,
      audit_id: null,
      mismatch,
      fuente_texto: texto.fuente,
      texto_chars: texto.texto_chars,
      error: null,
    };
  }

  if (onlyMismatches && !mismatch) {
    return {
      cedula_id: cedula.id,
      ok: true,
      tipo_documento_actual: cedula.tipo_documento,
      clasificacion_pdf: clasificado.clasificacion,
      confianza: clasificado.confianza,
      razones_count: razonesCompletas.length,
      audit_id: null,
      mismatch: false,
      fuente_texto: texto.fuente,
      texto_chars: texto.texto_chars,
      error: null,
    };
  }

  const { data: inserted, error: insertErr } = await svc
    .from("cedulas_tipo_documento_pdf_audit")
    .insert({
      cedula_id: cedula.id,
      tipo_documento_actual: cedula.tipo_documento,
      clasificacion_pdf: clasificado.clasificacion,
      confianza: clasificado.confianza,
      razones: razonesCompletas,
      texto_detectado: clasificado.texto_detectado,
      archivo_origen: downloadResult.archivo_origen,
      created_by: userId,
    })
    .select("id")
    .single();

  if (insertErr || !inserted?.id) {
    console.error("[tipo-doc-audit][run] insert audit falló", {
      cedula_id: cedula.id,
      error: insertErr?.message,
    });
    return {
      cedula_id: cedula.id,
      ok: false,
      tipo_documento_actual: cedula.tipo_documento,
      clasificacion_pdf: clasificado.clasificacion,
      confianza: clasificado.confianza,
      razones_count: razonesCompletas.length,
      audit_id: null,
      mismatch,
      fuente_texto: texto.fuente,
      texto_chars: texto.texto_chars,
      error: `Insert audit falló: ${insertErr?.message ?? "desconocido"}`,
    };
  }

  return {
    cedula_id: cedula.id,
    ok: true,
    tipo_documento_actual: cedula.tipo_documento,
    clasificacion_pdf: clasificado.clasificacion,
    confianza: clasificado.confianza,
    razones_count: razonesCompletas.length,
    audit_id: inserted.id,
    mismatch,
    fuente_texto: texto.fuente,
    texto_chars: texto.texto_chars,
    error: null,
  };
}
