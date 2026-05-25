import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  leerContextoDeRazones,
  leerFuenteDeRazones,
  requireSuperadmin,
} from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";

/**
 * GET /api/admin/auditoria-tipo-documento-pdf/list
 *
 * Devuelve los registros auditados (cedulas_tipo_documento_pdf_audit) JOIN
 * cedulas, ordenados por created_at DESC.
 *
 * Solo superadmin. Solo lectura.
 *
 * Query params:
 *   - only_mismatches=true → filtra a aquellos donde tipo_documento_actual != clasificacion_pdf
 *     (y excluye INDETERMINADO).
 *   - limit (default 100, max 500)
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede consultar la auditoría" },
      { status: 403 }
    );
  }

  const url = req.nextUrl.searchParams;
  const onlyMismatches = url.get("only_mismatches") === "true";
  const limitRaw = parseInt(url.get("limit") ?? "100", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

  const { data, error } = await svc
    .from("cedulas_tipo_documento_pdf_audit")
    .select(
      "id, cedula_id, tipo_documento_actual, clasificacion_pdf, confianza, razones, archivo_origen, aplicado, created_at, " +
        "cedulas:cedulas!cedulas_tipo_documento_pdf_audit_cedula_id_fkey(caratula, ocr_caratula, juzgado, ocr_exp_nro, ocr_destinatario, pdf_path, estado_ocr, pjn_cargado_at, tipo_documento)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[tipo-doc-audit][list] error:", error.message);
    return NextResponse.json(
      { error: "Error al listar auditoría", details: error.message },
      { status: 500 }
    );
  }

  type Row = {
    id: string;
    cedula_id: string;
    tipo_documento_actual: string | null;
    clasificacion_pdf: "CEDULA" | "OFICIO" | "INDETERMINADO";
    confianza: number | null;
    razones: unknown;
    archivo_origen: string | null;
    aplicado: boolean;
    created_at: string;
    cedulas: {
      caratula: string | null;
      ocr_caratula: string | null;
      juzgado: string | null;
      ocr_exp_nro: string | null;
      ocr_destinatario: string | null;
      pdf_path: string | null;
      estado_ocr: string | null;
      pjn_cargado_at: string | null;
      tipo_documento: string | null;
    } | null;
  };

  const rows = ((data ?? []) as unknown as Row[]).map((r) => {
    const tipoActual = r.cedulas?.tipo_documento ?? r.tipo_documento_actual;
    const mismatch =
      r.clasificacion_pdf !== "INDETERMINADO" &&
      tipoActual !== r.clasificacion_pdf;
    // Derivar fuente_texto / texto_chars desde las razones meta. Para registros
    // legados (pre-OCR) será { fuente_texto: null, texto_chars: null }.
    const meta = leerFuenteDeRazones(r.razones);
    // Reconstruir contexto detectado por GPT desde las razones meta. Para
    // registros legados (pre-GPT) será { todos null }.
    const contextoDetectado = leerContextoDeRazones(r.razones);
    return {
      id: r.id,
      cedula_id: r.cedula_id,
      tipo_documento_actual: r.tipo_documento_actual,
      tipo_documento_actual_cedulas: r.cedulas?.tipo_documento ?? null,
      clasificacion_pdf: r.clasificacion_pdf,
      confianza: r.confianza,
      razones: r.razones,
      archivo_origen: r.archivo_origen,
      aplicado: r.aplicado,
      created_at: r.created_at,
      caratula: r.cedulas?.caratula ?? null,
      ocr_caratula: r.cedulas?.ocr_caratula ?? null,
      juzgado: r.cedulas?.juzgado ?? null,
      ocr_exp_nro: r.cedulas?.ocr_exp_nro ?? null,
      ocr_destinatario: r.cedulas?.ocr_destinatario ?? null,
      pdf_path: r.cedulas?.pdf_path ?? null,
      estado_ocr: r.cedulas?.estado_ocr ?? null,
      pjn_cargado_at: r.cedulas?.pjn_cargado_at ?? null,
      mismatch,
      fuente_texto: meta.fuente_texto,
      texto_chars: meta.texto_chars,
      contexto_detectado: contextoDetectado,
    };
  });

  const filtrados = onlyMismatches ? rows.filter((r) => r.mismatch) : rows;

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    total: filtrados.length,
    only_mismatches: onlyMismatches,
    rows: filtrados,
  });
}
