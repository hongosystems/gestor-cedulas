import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  STORAGE_BUCKET,
  calcularBreakdown,
  fetchCandidatosAuditoriaPdf,
  requireSuperadmin,
  type CedulaCandidato,
} from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const MUESTRA_MAX = 50;

type MuestraItem = {
  id: string;
  tipo_documento_actual: string | null;
  pdf_path: string | null;
  pdf_disponible: boolean;
  caratula: string | null;
  ocr_caratula: string | null;
  juzgado: string | null;
  ocr_exp_nro: string | null;
  ocr_destinatario: string | null;
  estado_ocr: string | null;
  pjn_cargado_at: string | null;
};

/**
 * GET /api/admin/auditoria-tipo-documento-pdf/preview
 *
 * Solo superadmin. No procesa OCR. No modifica nada.
 * Devuelve:
 *   - total candidatos
 *   - cantidad por tipo_documento actual (CEDULA / OFICIO / NULL / OTROS)
 *   - cantidad con/sin PDF (pdf_path)
 *   - muestra (50)
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede consultar el preview de auditoría de tipo documento por PDF" },
      { status: 403 }
    );
  }

  console.log("[tipo-doc-audit][preview] inicio", { userId: user.id });

  const fetchResult = await fetchCandidatosAuditoriaPdf(svc);
  if (!fetchResult.ok) {
    console.error("[tipo-doc-audit][preview] error al listar candidatos:", fetchResult.error);
    return NextResponse.json(
      { error: "Error al listar candidatos", details: fetchResult.error },
      { status: 500 }
    );
  }

  const candidatos: CedulaCandidato[] = fetchResult.candidatos;
  const breakdown = calcularBreakdown(candidatos);

  const muestra: MuestraItem[] = candidatos.slice(0, MUESTRA_MAX).map((c) => ({
    id: c.id,
    tipo_documento_actual: c.tipo_documento,
    pdf_path: c.pdf_path,
    pdf_disponible: !!c.pdf_path?.trim(),
    caratula: c.caratula?.trim() || null,
    ocr_caratula: c.ocr_caratula?.trim() || null,
    juzgado: c.juzgado?.trim() || null,
    ocr_exp_nro: c.ocr_exp_nro?.trim() || null,
    ocr_destinatario: c.ocr_destinatario?.trim() || null,
    estado_ocr: c.estado_ocr,
    pjn_cargado_at: c.pjn_cargado_at,
  }));

  console.log("[tipo-doc-audit][preview] resultado", {
    userId: user.id,
    total: breakdown.total,
    con_pdf: breakdown.con_pdf,
    sin_pdf: breakdown.sin_pdf,
    por_tipo_actual: breakdown.por_tipo_actual,
  });

  return NextResponse.json({
    ok: true,
    modo: "preview_solo_lectura",
    generated_at: new Date().toISOString(),
    nota:
      "Preview de auditoría. No se descargaron PDFs, no se ejecutó OCR ni clasificación. Solo conteos sobre cedulas.",
    storage: { bucket: STORAGE_BUCKET, path_field: "cedulas.pdf_path" },
    total: breakdown.total,
    con_pdf: breakdown.con_pdf,
    sin_pdf: breakdown.sin_pdf,
    por_tipo_actual: breakdown.por_tipo_actual,
    muestra,
  });
}
