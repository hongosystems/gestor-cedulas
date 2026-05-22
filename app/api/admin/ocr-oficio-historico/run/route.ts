import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  STORAGE_BUCKET,
  fetchCandidatosOcrOficioHistorico,
  invocarProcesarOficio,
  buildPatchOcrOficioHistorico,
  requireSuperadmin,
} from "@/lib/ocr-oficio-historico";

export const runtime = "nodejs";
export const maxDuration = 300;

const LIMIT_DEFAULT = 3;
const LIMIT_MAX = 5;

type RunItemResult = {
  id: string;
  ok: boolean;
  destinatario_extraido: string | null;
  campos_actualizados: string[];
  error: string | null;
};

function parseBool(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return defaultValue;
}

function parseLimit(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (Number.isNaN(n) || n < 1) return LIMIT_DEFAULT;
  return Math.min(n, LIMIT_MAX);
}

async function parseRunParams(req: NextRequest): Promise<{ limit: number; dryRun: boolean }> {
  const url = req.nextUrl.searchParams;
  let limit = parseLimit(url.get("limit"));
  let dryRun = parseBool(url.get("dry_run"), true);

  try {
    const body = await req.json();
    if (body && typeof body === "object") {
      if ("limit" in body) limit = parseLimit(body.limit);
      if ("dry_run" in body) dryRun = parseBool(body.dry_run, true);
    }
  } catch {
    // body vacío o no JSON: usar query
  }

  return { limit, dryRun };
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede ejecutar OCR oficio histórico" },
      { status: 403 }
    );
  }

  const { limit, dryRun } = await parseRunParams(req);
  const railwayOcrUrl = process.env.RAILWAY_OCR_URL?.trim() || null;

  if (!dryRun && !railwayOcrUrl) {
    return NextResponse.json(
      { error: "RAILWAY_OCR_URL no configurada; no se puede ejecutar OCR real" },
      { status: 500 }
    );
  }

  console.log("[ocr-oficio-historico/run] Inicio", {
    userId: user.id,
    limit,
    dryRun,
  });

  const fetchResult = await fetchCandidatosOcrOficioHistorico(svc);
  if (!fetchResult.ok) {
    return NextResponse.json(
      {
        error: fetchResult.error,
        details: fetchResult.details,
      },
      { status: 500 }
    );
  }

  const pendientes = fetchResult.candidatos;
  const lote = pendientes.slice(0, limit);
  const resultados: RunItemResult[] = [];

  for (const cedula of lote) {
    if (dryRun) {
      resultados.push({
        id: cedula.id,
        ok: true,
        destinatario_extraido: null,
        campos_actualizados: [],
        error: null,
      });
      continue;
    }

    const pdfPath = cedula.pdf_path?.trim();
    if (!pdfPath) {
      resultados.push({
        id: cedula.id,
        ok: false,
        destinatario_extraido: null,
        campos_actualizados: [],
        error: "pdf_path vacío en base de datos",
      });
      continue;
    }

    const { data: fileData, error: downloadErr } = await svc.storage
      .from(STORAGE_BUCKET)
      .download(pdfPath);

    if (downloadErr || !fileData) {
      resultados.push({
        id: cedula.id,
        ok: false,
        destinatario_extraido: null,
        campos_actualizados: [],
        error: downloadErr?.message || "No se pudo descargar el PDF",
      });
      continue;
    }

    const pdfBuffer = Buffer.from(await fileData.arrayBuffer());
    const ocrResult = await invocarProcesarOficio(pdfBuffer, railwayOcrUrl!);

    if (!ocrResult.ok) {
      resultados.push({
        id: cedula.id,
        ok: false,
        destinatario_extraido: null,
        campos_actualizados: [],
        error: ocrResult.error,
      });
      continue;
    }

    const patchResult = buildPatchOcrOficioHistorico(cedula, ocrResult.headers);
    if ("error" in patchResult) {
      resultados.push({
        id: cedula.id,
        ok: false,
        destinatario_extraido: ocrResult.headers.destinatario,
        campos_actualizados: [],
        error: patchResult.error,
      });
      continue;
    }

    const { error: updateErr } = await svc
      .from("cedulas")
      .update(patchResult.patch)
      .eq("id", cedula.id);

    if (updateErr) {
      resultados.push({
        id: cedula.id,
        ok: false,
        destinatario_extraido: ocrResult.headers.destinatario,
        campos_actualizados: [],
        error: `Error al actualizar cédula: ${updateErr.message}`,
      });
      continue;
    }

    console.log("[ocr-oficio-historico/run] OK", {
      id: cedula.id,
      campos: patchResult.campos,
    });

    resultados.push({
      id: cedula.id,
      ok: true,
      destinatario_extraido: ocrResult.headers.destinatario,
      campos_actualizados: patchResult.campos.filter((c) => c !== "ocr_error"),
      error: null,
    });
  }

  const procesadosOk = resultados.filter((r) => r.ok).length;
  const procesadosError = resultados.filter((r) => !r.ok).length;

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    generated_at: new Date().toISOString(),
    nota: dryRun
      ? "Simulación: no se llamó OCR ni se modificó la base. Enviar dry_run=false para ejecutar."
      : "OCR ejecutado. No se modificó pjn_cargado_at, estado_ocr ni pdf_acredita_url.",
    parametros: { limit, dry_run: dryRun, limit_max: LIMIT_MAX },
    universo_pendiente: pendientes.length,
    procesados_en_esta_llamada: lote.length,
    pendientes_restantes: Math.max(0, pendientes.length - lote.length),
    exitosos: procesadosOk,
    fallidos: procesadosError,
    resultados,
  });
}
