import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import { procesarOcrEnBackground } from "@/lib/cedula-procesar-ocr";
import { requireSuperadmin } from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  tipo_documento: "CEDULA" | "OFICIO";
  motivo?: string;
  /** Default true: reprocesa OCR con el endpoint correcto. */
  reprocesar_ocr?: boolean;
};

async function requireAdminCedulas(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_admin_cedulas, is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_admin_cedulas === true || data?.is_superadmin === true;
}

/**
 * POST /api/admin/cedulas/[id]/corregir-tipo-documento
 *
 * Corrige tipo_documento en un registro existente (auditoría reversible) y
 * opcionalmente dispara reproceso OCR con el endpoint Railway adecuado.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  const isSuperadmin = await requireSuperadmin(user.id, svc);
  const isAdminCedulas = await requireAdminCedulas(user.id, svc);
  if (!isSuperadmin && !isAdminCedulas) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nuevoTipo = String(body.tipo_documento || "").trim().toUpperCase();
  if (nuevoTipo !== "CEDULA" && nuevoTipo !== "OFICIO") {
    return NextResponse.json(
      { error: "tipo_documento debe ser CEDULA u OFICIO" },
      { status: 400 }
    );
  }

  const reprocesarOcr = body.reprocesar_ocr !== false;
  const motivo =
    (body.motivo || "").trim() ||
    "correccion_manual_tipo_documento";

  const { data: cedula, error: fetchErr } = await svc
    .from("cedulas")
    .select("id, tipo_documento, pdf_path, pjn_cargado_at, estado_ocr")
    .eq("id", cedulaId)
    .single();

  if (fetchErr || !cedula) {
    return NextResponse.json({ error: "Cédula no encontrada" }, { status: 404 });
  }

  const anterior = cedula.tipo_documento;
  if (anterior === nuevoTipo) {
    return NextResponse.json({
      ok: true,
      cedula_id: cedulaId,
      tipo_documento: nuevoTipo,
      cambio: false,
      reprocesar_ocr: false,
      mensaje: "El tipo ya era el solicitado",
    });
  }

  const { error: auditErr } = await svc.from("cedulas_tipo_documento_audit").insert({
    cedula_id: cedulaId,
    tipo_documento_anterior: anterior,
    tipo_documento_nuevo: nuevoTipo,
    motivo,
    aplicado_at: new Date().toISOString(),
  });

  if (auditErr) {
    const missingTable = auditErr.message?.includes("cedulas_tipo_documento_audit");
    if (!missingTable) {
      return NextResponse.json(
        { error: `No se pudo registrar auditoría: ${auditErr.message}` },
        { status: 500 }
      );
    }
    console.warn("[corregir-tipo-documento] audit table missing, continuing");
  }

  const { error: updErr } = await svc
    .from("cedulas")
    .update({ tipo_documento: nuevoTipo })
    .eq("id", cedulaId);

  if (updErr) {
    return NextResponse.json(
      { error: updErr.message || "No se pudo actualizar tipo_documento" },
      { status: 500 }
    );
  }

  let ocrStatus: string | null = null;
  if (reprocesarOcr) {
    if (!cedula.pdf_path) {
      return NextResponse.json(
        {
          ok: true,
          cedula_id: cedulaId,
          tipo_documento: nuevoTipo,
          cambio: true,
          reprocesar_ocr: false,
          advertencia: "tipo actualizado pero sin pdf_path para reprocesar OCR",
        },
        { status: 200 }
      );
    }

    await svc.from("cedulas").update({ estado_ocr: "procesando" }).eq("id", cedulaId);

    const skipCargarPjn = !!cedula.pjn_cargado_at;
    after(() =>
      procesarOcrEnBackground(cedulaId, svc, { skipCargarPjn })
    );
    ocrStatus = "procesando";
  }

  return NextResponse.json({
    ok: true,
    cedula_id: cedulaId,
    tipo_documento_anterior: anterior,
    tipo_documento: nuevoTipo,
    cambio: true,
    reprocesar_ocr: reprocesarOcr,
    ocr_status: ocrStatus,
    skip_cargar_pjn: reprocesarOcr ? !!cedula.pjn_cargado_at : null,
    mensaje:
      reprocesarOcr && cedula.pjn_cargado_at
        ? "Tipo corregido y OCR en curso. PJN ya estaba cargado: no se reinvoca cargar-pjn automáticamente; revisar descripción en PJN si hace falta."
        : reprocesarOcr
          ? "Tipo corregido y OCR en curso"
          : "Tipo corregido",
  });
}
