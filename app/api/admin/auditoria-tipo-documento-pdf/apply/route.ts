import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  evaluarAplicabilidadAudit,
  requireSuperadmin,
  resolverTipoNuevoAudit,
  tieneInconsistenciaTipo,
  type RollbackDataPdfAudit,
} from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";

type Body = {
  audit_ids: string[];
  confirm?: boolean;
};

type ItemResult = {
  audit_id: string;
  status: "applied" | "rejected" | "error";
  motivo: string | null;
  cedula_id?: string;
  tipo_documento_anterior?: string | null;
  tipo_documento_nuevo?: string;
};

/**
 * POST /api/admin/auditoria-tipo-documento-pdf/apply
 *
 * Aplica correcciones confirmadas: solo UPDATE cedulas.tipo_documento.
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede aplicar correcciones" },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      { error: "Se requiere confirm: true para aplicar correcciones" },
      { status: 400 }
    );
  }

  const rawIds = Array.isArray(body.audit_ids) ? body.audit_ids : [];
  const auditIds = rawIds.map((id) => String(id).trim()).filter(Boolean);

  if (auditIds.length === 0) {
    return NextResponse.json(
      { error: "audit_ids debe contener al menos un id" },
      { status: 400 }
    );
  }

  const seen = new Set<string>();
  const duplicados: string[] = [];
  for (const id of auditIds) {
    if (seen.has(id)) duplicados.push(id);
    else seen.add(id);
  }
  if (duplicados.length > 0) {
    return NextResponse.json(
      { error: "audit_ids contiene ids duplicados", duplicados },
      { status: 400 }
    );
  }

  const resultados: ItemResult[] = [];
  let aplicadas = 0;
  let rechazadas = 0;
  let errores = 0;

  for (const auditId of auditIds) {
    const { data: audit, error: fetchErr } = await svc
      .from("cedulas_tipo_documento_pdf_audit")
      .select(
        "id, cedula_id, tipo_documento_actual, clasificacion_pdf, clasificacion_manual, confianza, aplicado, revisado, revision_estado"
      )
      .eq("id", auditId)
      .maybeSingle();

    if (fetchErr) {
      errores++;
      resultados.push({
        audit_id: auditId,
        status: "error",
        motivo: fetchErr.message,
      });
      continue;
    }

    if (!audit) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        motivo: "Auditoría no encontrada",
      });
      continue;
    }

    const { data: cedula, error: cedulaErr } = await svc
      .from("cedulas")
      .select("id, tipo_documento")
      .eq("id", audit.cedula_id)
      .maybeSingle();

    if (cedulaErr || !cedula) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        motivo: "Cédula no encontrada",
        cedula_id: audit.cedula_id,
      });
      continue;
    }

    const tipoActualLive = cedula.tipo_documento;
    const tipoNuevo = resolverTipoNuevoAudit(
      audit.clasificacion_manual,
      audit.clasificacion_pdf
    );

    const evalResult = evaluarAplicabilidadAudit({
      revision_estado: audit.revision_estado,
      revisado: audit.revisado === true,
      clasificacion_pdf: audit.clasificacion_pdf,
      clasificacion_manual: audit.clasificacion_manual,
      confianza:
        audit.confianza != null ? Number(audit.confianza) : null,
      aplicado: audit.aplicado === true,
      tipo_documento_actual: tipoActualLive,
      mismatch: tipoNuevo
        ? tieneInconsistenciaTipo(tipoActualLive, tipoNuevo)
        : false,
    });

    if (!evalResult.aplicable || !tipoNuevo) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        motivo: evalResult.motivo ?? "Sin tipo aplicable",
        cedula_id: audit.cedula_id,
        tipo_documento_anterior: tipoActualLive,
        tipo_documento_nuevo: tipoNuevo ?? undefined,
      });
      continue;
    }
    const appliedAt = new Date().toISOString();
    const rollbackData: RollbackDataPdfAudit = {
      cedula_id: audit.cedula_id,
      audit_id: audit.id,
      tipo_documento_anterior: tipoActualLive,
      tipo_documento_nuevo: tipoNuevo,
      confianza: audit.confianza != null ? Number(audit.confianza) : null,
      revision_estado: "CONFIRMADO",
      applied_by: user.id,
      applied_at: appliedAt,
      clasificacion_manual: audit.clasificacion_manual ?? null,
      clasificacion_pdf: audit.clasificacion_pdf,
    };

    const { error: updCedulaErr } = await svc
      .from("cedulas")
      .update({ tipo_documento: tipoNuevo })
      .eq("id", audit.cedula_id);

    if (updCedulaErr) {
      errores++;
      resultados.push({
        audit_id: auditId,
        status: "error",
        motivo: updCedulaErr.message,
        cedula_id: audit.cedula_id,
      });
      continue;
    }

    const { error: updAuditErr } = await svc
      .from("cedulas_tipo_documento_pdf_audit")
      .update({
        aplicado: true,
        aplicado_at: appliedAt,
        rollback_data: rollbackData,
      })
      .eq("id", auditId)
      .eq("aplicado", false);

    if (updAuditErr) {
      // Revertir cédula si falló marcar auditoría (best-effort)
      await svc
        .from("cedulas")
        .update({ tipo_documento: tipoActualLive })
        .eq("id", audit.cedula_id);
      errores++;
      resultados.push({
        audit_id: auditId,
        status: "error",
        motivo: `Cédula actualizada pero falló marcar auditoría: ${updAuditErr.message}`,
        cedula_id: audit.cedula_id,
      });
      continue;
    }

    aplicadas++;
    resultados.push({
      audit_id: auditId,
      status: "applied",
      motivo: null,
      cedula_id: audit.cedula_id,
      tipo_documento_anterior: tipoActualLive,
      tipo_documento_nuevo: tipoNuevo,
    });
  }

  console.info(
    `[tipo-doc-audit][apply] user=${user.id} aplicadas=${aplicadas} rechazadas=${rechazadas} errores=${errores}`
  );

  return NextResponse.json({
    ok: true,
    mensaje:
      aplicadas > 0
        ? "Se modificó cedulas.tipo_documento en las filas aplicadas."
        : "No se aplicaron cambios en cedulas.tipo_documento.",
    cedulas_modificada: aplicadas > 0,
    aplicadas,
    rechazadas,
    errores,
    total: auditIds.length,
    resultados,
  });
}
