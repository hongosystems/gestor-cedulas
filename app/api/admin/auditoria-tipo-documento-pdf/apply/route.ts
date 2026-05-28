import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  AUDIT_APPLY_MIN_CONFIDENCE,
  evaluarAplicabilidadAudit,
  normalizarTipoDocumento,
  requireSuperadmin,
  resolverTipoNuevoAudit,
  revisionPermiteApply,
  tieneClasificacionManualAplicable,
  tiposCoinciden,
  type ApplyEstado,
  type RollbackDataPdfAudit,
} from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";

type Body = {
  audit_ids: string[];
  confirm?: boolean;
  allow_noop?: boolean;
};

type ItemStatus = "applied" | "noop" | "rejected" | "error";

type ItemResult = {
  audit_id: string;
  status: ItemStatus;
  apply_estado?: ApplyEstado;
  motivo: string | null;
  cedula_id?: string;
  tipo_documento_anterior?: string | null;
  tipo_documento_nuevo?: string;
};

/**
 * POST /api/admin/auditoria-tipo-documento-pdf/apply
 *
 * Aplica correcciones confirmadas: solo UPDATE cedulas.tipo_documento.
 * Con allow_noop=true registra SIN_CAMBIOS sin UPDATE.
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

  const allowNoop = body.allow_noop === true;
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
  let sinCambios = 0;
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
        apply_estado: "ERROR",
        motivo: fetchErr.message,
      });
      continue;
    }

    if (!audit) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        apply_estado: "RECHAZADO",
        motivo: "Auditoría no encontrada",
      });
      continue;
    }

    if (audit.aplicado === true) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        apply_estado: "RECHAZADO",
        motivo: "Ya aplicado",
        cedula_id: audit.cedula_id,
      });
      continue;
    }

    if (!audit.revisado || !revisionPermiteApply(audit.revision_estado)) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        apply_estado: "RECHAZADO",
        motivo: "Revisión no válida para apply (requiere CONFIRMADO o VALIDADO_SIN_CAMBIOS)",
        cedula_id: audit.cedula_id,
      });
      continue;
    }

    const tipoNuevo = resolverTipoNuevoAudit(
      audit.clasificacion_manual,
      audit.clasificacion_pdf
    );

    if (!tipoNuevo) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        apply_estado: "RECHAZADO",
        motivo: "tipo_nuevo inválido (INDETERMINADO)",
        cedula_id: audit.cedula_id,
      });
      continue;
    }

    if (
      !tieneClasificacionManualAplicable(audit.clasificacion_manual) &&
      (audit.confianza == null || Number(audit.confianza) < AUDIT_APPLY_MIN_CONFIDENCE)
    ) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        apply_estado: "RECHAZADO",
        motivo: `Confianza insuficiente (< ${AUDIT_APPLY_MIN_CONFIDENCE})`,
        cedula_id: audit.cedula_id,
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
        apply_estado: "RECHAZADO",
        motivo: "Cédula no encontrada",
        cedula_id: audit.cedula_id,
      });
      continue;
    }

    const tipoActualLive = cedula.tipo_documento;
    const evalResult = evaluarAplicabilidadAudit({
      revision_estado: audit.revision_estado,
      revisado: true,
      clasificacion_pdf: audit.clasificacion_pdf,
      clasificacion_manual: audit.clasificacion_manual,
      confianza: audit.confianza != null ? Number(audit.confianza) : null,
      aplicado: false,
      tipo_documento_actual: tipoActualLive,
      allow_noop: allowNoop,
    });

    if (!evalResult.aplicable) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        apply_estado: "RECHAZADO",
        motivo: evalResult.motivo,
        cedula_id: audit.cedula_id,
        tipo_documento_anterior: tipoActualLive,
        tipo_documento_nuevo: tipoNuevo,
      });
      continue;
    }

    const appliedAt = new Date().toISOString();
    const revisionEstado = (audit.revision_estado ?? "CONFIRMADO") as RollbackDataPdfAudit["revision_estado"];
    const rollbackData: RollbackDataPdfAudit = {
      cedula_id: audit.cedula_id,
      audit_id: audit.id,
      tipo_documento_anterior: tipoActualLive,
      tipo_documento_nuevo: tipoNuevo,
      confianza: audit.confianza != null ? Number(audit.confianza) : null,
      revision_estado: revisionEstado,
      applied_by: user.id,
      applied_at: appliedAt,
      clasificacion_manual: audit.clasificacion_manual ?? null,
      clasificacion_pdf: audit.clasificacion_pdf,
    };

    const esNoop = tiposCoinciden(tipoActualLive, tipoNuevo);
    if (esNoop) {
      rollbackData.apply_estado = "SIN_CAMBIOS";
      const { error: updAuditErr } = await svc
        .from("cedulas_tipo_documento_pdf_audit")
        .update({
          aplicado: true,
          aplicado_at: appliedAt,
          aplicado_by: user.id,
          apply_estado: "SIN_CAMBIOS",
          rollback_data: rollbackData,
        })
        .eq("id", auditId)
        .eq("aplicado", false);

      if (updAuditErr) {
        errores++;
        resultados.push({
          audit_id: auditId,
          status: "error",
          apply_estado: "ERROR",
          motivo: updAuditErr.message,
          cedula_id: audit.cedula_id,
        });
        continue;
      }

      sinCambios++;
      resultados.push({
        audit_id: auditId,
        status: "noop",
        apply_estado: "SIN_CAMBIOS",
        motivo: null,
        cedula_id: audit.cedula_id,
        tipo_documento_anterior: tipoActualLive,
        tipo_documento_nuevo: tipoNuevo,
      });
      continue;
    }

    const actualNorm = normalizarTipoDocumento(tipoActualLive);
    if (actualNorm === tipoNuevo) {
      rechazadas++;
      resultados.push({
        audit_id: auditId,
        status: "rejected",
        apply_estado: "RECHAZADO",
        motivo: "sin cambios",
        cedula_id: audit.cedula_id,
      });
      continue;
    }

    rollbackData.apply_estado = "APLICADO";
    const { error: updCedulaErr } = await svc
      .from("cedulas")
      .update({ tipo_documento: tipoNuevo })
      .eq("id", audit.cedula_id);

    if (updCedulaErr) {
      errores++;
      resultados.push({
        audit_id: auditId,
        status: "error",
        apply_estado: "ERROR",
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
        aplicado_by: user.id,
        apply_estado: "APLICADO",
        rollback_data: rollbackData,
      })
      .eq("id", auditId)
      .eq("aplicado", false);

    if (updAuditErr) {
      await svc
        .from("cedulas")
        .update({ tipo_documento: tipoActualLive })
        .eq("id", audit.cedula_id);
      errores++;
      resultados.push({
        audit_id: auditId,
        status: "error",
        apply_estado: "ERROR",
        motivo: `Cédula actualizada pero falló marcar auditoría: ${updAuditErr.message}`,
        cedula_id: audit.cedula_id,
      });
      continue;
    }

    aplicadas++;
    resultados.push({
      audit_id: auditId,
      status: "applied",
      apply_estado: "APLICADO",
      motivo: null,
      cedula_id: audit.cedula_id,
      tipo_documento_anterior: tipoActualLive,
      tipo_documento_nuevo: tipoNuevo,
    });
  }

  console.info(
    `[tipo-doc-audit][apply] user=${user.id} aplicadas=${aplicadas} sin_cambios=${sinCambios} rechazadas=${rechazadas} errores=${errores}`
  );

  return NextResponse.json({
    ok: true,
    mensaje:
      aplicadas > 0
        ? "Se modificó cedulas.tipo_documento en las filas aplicadas."
        : sinCambios > 0
          ? "Registros marcados SIN_CAMBIOS. No se modificó cedulas.tipo_documento."
          : "No se aplicaron cambios en cedulas.tipo_documento.",
    cedulas_modificada: aplicadas > 0,
    aplicadas,
    sin_cambios: sinCambios,
    rechazadas,
    errores,
    total: auditIds.length,
    resultados,
  });
}
