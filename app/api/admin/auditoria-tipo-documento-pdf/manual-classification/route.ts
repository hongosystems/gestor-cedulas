import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  CLASIFICACIONES_MANUALES,
  evaluarAplicabilidadAudit,
  requireSuperadmin,
  tieneInconsistenciaTipo,
  type ClasificacionManual,
} from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";

type Body = {
  audit_id: string;
  tipo: ClasificacionManual;
  nota?: string | null;
};

/**
 * POST /api/admin/auditoria-tipo-documento-pdf/manual-classification
 *
 * Resuelve INDETERMINADO en la fila de auditoría. No modifica cedulas.
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede clasificar manualmente" },
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

  const tipo = String(body.tipo || "")
    .trim()
    .toUpperCase() as ClasificacionManual;
  if (!CLASIFICACIONES_MANUALES.includes(tipo)) {
    return NextResponse.json(
      { error: "tipo debe ser CEDULA, OFICIO o INDETERMINADO" },
      { status: 400 }
    );
  }

  const notaRaw = body.nota != null ? String(body.nota).trim() : "";
  if ((tipo === "CEDULA" || tipo === "OFICIO") && notaRaw.length === 0) {
    return NextResponse.json(
      { error: "nota obligatoria al elegir CEDULA u OFICIO" },
      { status: 400 }
    );
  }

  const { data: existing, error: fetchErr } = await svc
    .from("cedulas_tipo_documento_pdf_audit")
    .select(
      "id, cedula_id, clasificacion_pdf, confianza, aplicado, revisado, revision_estado, tipo_documento_actual"
    )
    .eq("id", auditId)
    .maybeSingle();

  if (fetchErr) {
    console.error("[tipo-doc-audit][manual-classification] fetch:", fetchErr.message);
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
      { error: "No se puede clasificar manualmente una auditoría ya aplicada" },
      { status: 409 }
    );
  }

  if (existing.clasificacion_pdf !== "INDETERMINADO") {
    return NextResponse.json(
      {
        error:
          "Clasificación manual solo aplica cuando clasificacion_pdf es INDETERMINADO",
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const revisionEstado = tipo === "INDETERMINADO" ? "DUDA" : "CONFIRMADO";
  const revisionNota =
    tipo === "INDETERMINADO"
      ? notaRaw.length > 0
        ? notaRaw
        : "Mantenido INDETERMINADO (clasificación manual)"
      : notaRaw;

  const { data: updated, error: updErr } = await svc
    .from("cedulas_tipo_documento_pdf_audit")
    .update({
      clasificacion_manual: tipo,
      clasificacion_manual_at: now,
      clasificacion_manual_by: user.id,
      clasificacion_manual_nota: notaRaw.length > 0 ? notaRaw : null,
      revisado: true,
      revisado_at: now,
      revisado_by: user.id,
      revision_estado: revisionEstado,
      revision_nota: revisionNota,
    })
    .eq("id", auditId)
    .select(
      "id, clasificacion_manual, clasificacion_manual_at, clasificacion_manual_by, clasificacion_manual_nota, revisado, revisado_at, revisado_by, revision_estado, revision_nota"
    )
    .single();

  if (updErr) {
    console.error("[tipo-doc-audit][manual-classification] update:", updErr.message);
    return NextResponse.json(
      { error: "No se pudo guardar la clasificación manual", details: updErr.message },
      { status: 500 }
    );
  }

  const { data: cedula } = await svc
    .from("cedulas")
    .select("tipo_documento")
    .eq("id", existing.cedula_id)
    .maybeSingle();

  const tipoActualLive = cedula?.tipo_documento ?? existing.tipo_documento_actual;
  const mismatch = tieneInconsistenciaTipo(tipoActualLive, existing.clasificacion_pdf);
  const aplicabilidad = evaluarAplicabilidadAudit({
    revision_estado: revisionEstado,
    revisado: true,
    clasificacion_pdf: existing.clasificacion_pdf,
    clasificacion_manual: tipo,
    confianza: existing.confianza != null ? Number(existing.confianza) : null,
    aplicado: false,
    tipo_documento_actual: tipoActualLive,
    mismatch,
  });

  return NextResponse.json({
    ok: true,
    mensaje:
      "Solo se actualizó la auditoría (clasificación manual y revisión). No se modificó cedulas.tipo_documento.",
    cedulas_modificada: false,
    campos_modificados: [
      "clasificacion_manual",
      "clasificacion_manual_at",
      "clasificacion_manual_by",
      "clasificacion_manual_nota",
      "revisado",
      "revisado_at",
      "revisado_by",
      "revision_estado",
      "revision_nota",
    ],
    audit: updated,
    aplicable: aplicabilidad.aplicable,
    aplicable_motivo: aplicabilidad.motivo,
  });
}
