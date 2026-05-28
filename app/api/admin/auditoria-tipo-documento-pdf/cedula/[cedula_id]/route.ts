import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import { requireSuperadmin } from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";

/**
 * GET /api/admin/auditoria-tipo-documento-pdf/cedula/[cedula_id]
 *
 * Lectura de cedulas para verificación post-apply. Solo superadmin.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ cedula_id: string }> }
) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede consultar cédulas" },
      { status: 403 }
    );
  }

  const { cedula_id: cedulaIdRaw } = await ctx.params;
  const cedulaId = String(cedulaIdRaw || "").trim();
  if (!cedulaId) {
    return NextResponse.json({ error: "cedula_id requerido" }, { status: 400 });
  }

  const { data, error } = await svc
    .from("cedulas")
    .select(
      "id, tipo_documento, ocr_exp_nro, caratula, ocr_caratula, juzgado, ocr_destinatario, pdf_path, created_at"
    )
    .eq("id", cedulaId)
    .maybeSingle();

  if (error) {
    console.error("[tipo-doc-audit][cedula] fetch:", error.message);
    return NextResponse.json(
      { error: "Error al leer cédula", details: error.message },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Cédula no encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    cedula: {
      cedula_id: data.id,
      tipo_documento: data.tipo_documento,
      expediente: data.ocr_exp_nro,
      caratula: data.caratula ?? data.ocr_caratula,
      juzgado: data.juzgado,
      destinatario: data.ocr_destinatario,
      pdf_path: data.pdf_path,
      created_at: data.created_at ?? null,
    },
  });
}
