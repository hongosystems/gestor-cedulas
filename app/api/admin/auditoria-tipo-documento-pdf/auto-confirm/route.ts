import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  AUTO_CONFIRM_DEFAULT_LIMIT,
  AUTO_CONFIRM_DEFAULT_MIN_CONFIDENCE,
  AUTO_CONFIRM_MAX_LIMIT,
  AUTO_CONFIRM_MIN_CONFIDENCE_FLOOR,
  evaluarCandidatoAutoConfirm,
  leerContextoDeRazones,
  leerFuenteDeRazones,
  requireSuperadmin,
  tieneInconsistenciaTipo,
  type AutoConfirmRow,
} from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";

type Body = {
  min_confianza?: number;
  only_mismatches?: boolean;
  include_null_actual?: boolean;
  limit?: number;
  dry_run?: boolean;
  confirm?: boolean;
};

/** Cap de filas leídas cuando el filtro de inconsistencia se aplica en memoria. */
const RAW_FETCH_CAP = 5000;

/**
 * POST /api/admin/auditoria-tipo-documento-pdf/auto-confirm
 *
 * Operación PURA de base de datos sobre auditorías ya guardadas.
 * NO llama /run, GPT Vision, Storage, PDFs ni OpenAI.
 * NO modifica cedulas.tipo_documento.
 *
 * Equivalente conceptual:
 *   SELECT * FROM cedulas_tipo_documento_pdf_audit
 *   WHERE revisado IS NOT TRUE AND aplicado IS NOT TRUE
 *     AND clasificacion_pdf IN ('CEDULA','OFICIO')
 *     AND confianza >= min_confianza
 *     AND (tipo_documento_actual IS NULL OR tipo_documento_actual != clasificacion_pdf)  [si only_mismatches]
 *   ORDER BY confianza DESC, created_at DESC
 *   LIMIT ...
 */
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede auto-confirmar auditorías" },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const minConfianzaRaw = Number(
    body.min_confianza ?? AUTO_CONFIRM_DEFAULT_MIN_CONFIDENCE
  );
  const minConfianza = Number.isFinite(minConfianzaRaw)
    ? minConfianzaRaw
    : AUTO_CONFIRM_DEFAULT_MIN_CONFIDENCE;

  if (minConfianza < AUTO_CONFIRM_MIN_CONFIDENCE_FLOOR) {
    return NextResponse.json(
      {
        error: `min_confianza no puede ser menor a ${AUTO_CONFIRM_MIN_CONFIDENCE_FLOOR}`,
      },
      { status: 400 }
    );
  }

  const limitRaw = parseInt(String(body.limit ?? AUTO_CONFIRM_DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), AUTO_CONFIRM_MAX_LIMIT)
    : AUTO_CONFIRM_DEFAULT_LIMIT;

  const onlyMismatches = body.only_mismatches !== false;
  const includeNullActual = body.include_null_actual !== false;
  const dryRun = body.dry_run !== false;

  if (!dryRun && body.confirm !== true) {
    return NextResponse.json(
      { error: "dry_run=false requiere confirm: true" },
      { status: 400 }
    );
  }

  // Solo tabla audit — sin JOIN, sin Storage, sin reprocesar PDFs.
  let query = svc
    .from("cedulas_tipo_documento_pdf_audit")
    .select(
      "id, cedula_id, tipo_documento_actual, clasificacion_pdf, confianza, razones, revisado, aplicado, created_at"
    )
    .eq("revisado", false)
    .eq("aplicado", false)
    .in("clasificacion_pdf", ["CEDULA", "OFICIO"])
    .gte("confianza", minConfianza)
    .order("confianza", { ascending: false })
    .order("created_at", { ascending: false });

  query = query.limit(onlyMismatches ? RAW_FETCH_CAP : limit);

  const { data, error } = await query;

  if (error) {
    console.error("[tipo-doc-audit][auto-confirm] fetch:", error.message);
    return NextResponse.json(
      { error: "Error al buscar candidatas", details: error.message },
      { status: 500 }
    );
  }

  type DbRow = {
    id: string;
    cedula_id: string;
    tipo_documento_actual: string | null;
    clasificacion_pdf: string;
    confianza: number | null;
    razones: unknown;
    revisado: boolean;
    aplicado: boolean;
    created_at: string;
  };

  const elegibles: AutoConfirmRow[] = [];
  let omitidos = 0;

  for (const r of (data ?? []) as unknown as DbRow[]) {
    if (
      onlyMismatches &&
      !tieneInconsistenciaTipo(r.tipo_documento_actual, r.clasificacion_pdf)
    ) {
      omitidos++;
      continue;
    }

    if (
      !onlyMismatches &&
      includeNullActual &&
      !tieneInconsistenciaTipo(r.tipo_documento_actual, r.clasificacion_pdf)
    ) {
      const raw = (r.tipo_documento_actual ?? "").trim();
      if (raw && raw.toUpperCase() === r.clasificacion_pdf) {
        omitidos++;
        continue;
      }
    }

    // fuente_texto: metadata ya persistida en razones JSONB (sin llamar GPT).
    const fuente = leerFuenteDeRazones(r.razones);
    const evalResult = evaluarCandidatoAutoConfirm({
      revisado: r.revisado === true,
      aplicado: r.aplicado === true,
      clasificacion_pdf: r.clasificacion_pdf,
      confianza: r.confianza != null ? Number(r.confianza) : null,
      tipo_documento_actual: r.tipo_documento_actual,
      fuente_texto: fuente.fuente_texto,
      only_mismatches: onlyMismatches,
      include_null_actual: includeNullActual,
      min_confianza: minConfianza,
    });

    if (!evalResult.elegible) {
      omitidos++;
      continue;
    }

    const ctx = leerContextoDeRazones(r.razones);

    elegibles.push({
      audit_id: r.id,
      cedula_id: r.cedula_id,
      expediente: ctx.expediente,
      caratula: ctx.caratula,
      tipo_actual: r.tipo_documento_actual,
      detectado: r.clasificacion_pdf,
      confianza: r.confianza != null ? Number(r.confianza) : null,
      motivo: null,
    });
  }

  const candidatos = elegibles.length;
  const aProcesar = elegibles.slice(0, limit);
  const revisionNota = `Auto-confirmado por confianza >= ${minConfianza}`;

  if (!dryRun && aProcesar.length > 0) {
    const now = new Date().toISOString();
    const ids = aProcesar.map((x) => x.audit_id);
    const { error: updErr } = await svc
      .from("cedulas_tipo_documento_pdf_audit")
      .update({
        revisado: true,
        revision_estado: "CONFIRMADO",
        revisado_at: now,
        revisado_by: user.id,
        revision_nota: revisionNota,
      })
      .in("id", ids)
      .eq("revisado", false)
      .eq("aplicado", false);

    if (updErr) {
      console.error("[tipo-doc-audit][auto-confirm] update:", updErr.message);
      return NextResponse.json(
        { error: "No se pudo auto-confirmar", details: updErr.message },
        { status: 500 }
      );
    }
  }

  const confirmados = aProcesar.length;

  console.info(
    `[tipo-doc-audit][auto-confirm] db-only user=${user.id} dry_run=${dryRun} candidatos=${candidatos} confirmados=${confirmados} omitidos=${omitidos}`
  );

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    min_confianza: minConfianza,
    only_mismatches: onlyMismatches,
    include_null_actual: includeNullActual,
    limit,
    candidatos,
    confirmados,
    omitidos,
    nota: "Solo lectura/escritura en cedulas_tipo_documento_pdf_audit. Sin /run, GPT, Storage ni PDFs.",
    rows: aProcesar,
  });
}
