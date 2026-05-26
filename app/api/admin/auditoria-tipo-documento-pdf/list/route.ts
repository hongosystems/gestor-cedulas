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
 *   - mostrar_historial_completo (default false): por defecto se devuelve
 *     SOLO la última auditoría de cada `cedula_id` (la de `created_at` más
 *     reciente). Si true, se devuelven todas las filas (historial completo).
 *     No se borra nada en ningún caso.
 *   - limit (default 100, max 500). Se aplica DESPUÉS del dedupe.
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
  const mostrarHistorialCompleto =
    url.get("mostrar_historial_completo") === "true";
  const limitRaw = parseInt(url.get("limit") ?? "100", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

  // Trae un cap razonable de filas DESC; el dedupe por cedula_id (cuando
  // mostrar_historial_completo=false) ocurre en memoria, y el limit final se
  // aplica DESPUÉS del dedupe para que el caller siempre vea hasta `limit`
  // cédulas distintas, no `limit` filas crudas.
  const RAW_FETCH_CAP = 5000;
  const { data, error } = await svc
    .from("cedulas_tipo_documento_pdf_audit")
    .select(
      "id, cedula_id, tipo_documento_actual, clasificacion_pdf, confianza, razones, archivo_origen, aplicado, created_at, " +
        "cedulas:cedulas!cedulas_tipo_documento_pdf_audit_cedula_id_fkey(caratula, ocr_caratula, juzgado, ocr_exp_nro, ocr_destinatario, pdf_path, estado_ocr, pjn_cargado_at, tipo_documento)"
    )
    .order("created_at", { ascending: false })
    .limit(RAW_FETCH_CAP);

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

  // Dedupe por cedula_id: como `rows` viene en orden created_at DESC, la
  // primera ocurrencia de cada `cedula_id` es la más reciente. Conservar solo
  // ésa cuando mostrar_historial_completo=false. Nunca se borra nada en DB.
  let despuesDeDedupe: typeof rows;
  if (mostrarHistorialCompleto) {
    despuesDeDedupe = rows;
  } else {
    const vistos = new Set<string>();
    despuesDeDedupe = [];
    for (const r of rows) {
      if (vistos.has(r.cedula_id)) continue;
      vistos.add(r.cedula_id);
      despuesDeDedupe.push(r);
    }
  }

  const filtrados = onlyMismatches
    ? despuesDeDedupe.filter((r) => r.mismatch)
    : despuesDeDedupe;

  const conLimit = filtrados.slice(0, limit);

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    total: conLimit.length,
    total_sin_limit: filtrados.length,
    total_filas_raw: rows.length,
    truncado_por_cap: rows.length >= RAW_FETCH_CAP,
    cedulas_distintas: new Set(despuesDeDedupe.map((r) => r.cedula_id)).size,
    only_mismatches: onlyMismatches,
    mostrar_historial_completo: mostrarHistorialCompleto,
    rows: conLimit,
  });
}
