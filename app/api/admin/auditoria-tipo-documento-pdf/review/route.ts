import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  REVISION_ESTADOS,
  requireSuperadmin,
  type RevisionEstado,
} from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";

type Body = {
  audit_id: string;
  estado: RevisionEstado;
  nota?: string | null;
};

/**
 * POST /api/admin/auditoria-tipo-documento-pdf/review
 *
 * Marca una auditoría como revisada por humano. No modifica cedulas.
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede revisar auditorías" },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const auditId = String(body.audit_id || "").trim();
  if (!auditId) {
    return NextResponse.json({ error: "audit_id requerido" }, { status: 400 });
  }

  const estado = String(body.estado || "").trim().toUpperCase() as RevisionEstado;
  if (!REVISION_ESTADOS.includes(estado)) {
    return NextResponse.json(
      { error: "estado debe ser CONFIRMADO, RECHAZADO o DUDA" },
      { status: 400 }
    );
  }

  const notaRaw = body.nota != null ? String(body.nota).trim() : "";
  const revisionNota = notaRaw.length > 0 ? notaRaw : null;

  const { data: existing, error: fetchErr } = await svc
    .from("cedulas_tipo_documento_pdf_audit")
    .select("id, aplicado")
    .eq("id", auditId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[tipo-doc-audit][review] fetch:", fetchErr.message);
    return NextResponse.json(
      { error: "Error al buscar auditoría", details: fetchErr.message },
      { status: 500 }
    );
  }

  if (!existing) {
    return NextResponse.json({ error: "Auditoría no encontrada" }, { status: 404 });
  }

  if (existing.aplicado === true) {
    return NextResponse.json(
      { error: "No se puede revisar una auditoría ya aplicada" },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await svc
    .from("cedulas_tipo_documento_pdf_audit")
    .update({
      revisado: true,
      revisado_at: now,
      revisado_by: user.id,
      revision_estado: estado,
      revision_nota: revisionNota,
    })
    .eq("id", auditId)
    .select(
      "id, revisado, revisado_at, revisado_by, revision_estado, revision_nota"
    )
    .single();

  if (updErr) {
    console.error("[tipo-doc-audit][review] update:", updErr.message);
    return NextResponse.json(
      { error: "No se pudo guardar la revisión", details: updErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    mensaje:
      "Solo se actualizó la auditoría. No se modificó cedulas.tipo_documento.",
    cedulas_modificada: false,
    campos_modificados: [
      "revisado",
      "revisado_at",
      "revisado_by",
      "revision_estado",
      "revision_nota",
    ],
    audit: updated,
  });
}
