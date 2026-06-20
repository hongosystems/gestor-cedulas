import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import { requireSuperadmin } from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";

type Body = {
  owner_user_id: string;
  motivo?: string;
};

/**
 * POST /api/admin/expedientes/[id]/assign-owner
 * Superadmin asigna owner_user_id a un expediente local sin responsable.
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
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: expedienteId } = await context.params;
  if (!expedienteId || expedienteId.startsWith("pjn_")) {
    return NextResponse.json(
      { error: "ID de expediente local inválido (favoritos PJN no soportados aquí)" },
      { status: 400 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const ownerId = (body.owner_user_id || "").trim();
  if (!ownerId) {
    return NextResponse.json({ error: "owner_user_id requerido" }, { status: 400 });
  }

  const { data: exp, error: fetchErr } = await svc
    .from("expedientes")
    .select("id, owner_user_id, estado")
    .eq("id", expedienteId)
    .maybeSingle();

  if (fetchErr || !exp) {
    return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
  }

  if (exp.estado !== "ABIERTO") {
    return NextResponse.json({ error: "Solo expedientes ABIERTO" }, { status: 400 });
  }

  const ownerAnterior = exp.owner_user_id?.trim() || null;
  if (ownerAnterior === ownerId) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const senal = (body.motivo || "").trim() || "manual_superadmin";

  const { error: updErr } = await svc
    .from("expedientes")
    .update({ owner_user_id: ownerId })
    .eq("id", expedienteId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const { error: auditErr } = await svc.from("expedientes_owner_audit").insert({
    expediente_id: expedienteId,
    pjn_favorito_id: null,
    owner_asignado: ownerId,
    owner_anterior: ownerAnterior,
    senal,
    ejecutado_por: user.id,
    dry_run: false,
  });

  if (auditErr) {
    console.error("[assign-owner] audit failed:", auditErr.message);
  }

  return NextResponse.json({
    ok: true,
    expediente_id: expedienteId,
    owner_asignado: ownerId,
    owner_anterior: ownerAnterior,
  });
}
