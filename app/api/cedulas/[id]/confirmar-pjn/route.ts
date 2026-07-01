import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  DILIGENCIAMIENTO_FORBIDDEN_MSG,
  requireDiligenciamientoAccess,
} from "@/lib/diligenciamiento-access";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: "Sesión inválida o expirada. Volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  const svc = supabaseService();
  if (!(await requireDiligenciamientoAccess(user.id, svc))) {
    return NextResponse.json({ error: DILIGENCIAMIENTO_FORBIDDEN_MSG }, { status: 403 });
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as { reset?: boolean; manual?: boolean }));
  const reset = body?.reset === true;
  const manual = body?.manual === true;
  const marcarAt = new Date().toISOString();

  let updatePayload: {
    pjn_cargado_at?: string | null;
    pjn_cargado_manual_at?: string | null;
    observaciones_pjn?: string | null;
  };

  if (reset && manual) {
    updatePayload = { pjn_cargado_manual_at: null };
  } else if (reset) {
    updatePayload = { pjn_cargado_at: null, observaciones_pjn: null };
  } else if (manual) {
    updatePayload = { pjn_cargado_manual_at: marcarAt };
  } else {
    updatePayload = { pjn_cargado_at: marcarAt };
  }

  const { error } = await svc.from("cedulas").update(updatePayload).eq("id", cedulaId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (reset && manual) {
    return NextResponse.json({ ok: true, reset: true, manual: true, pjn_cargado_manual_at: null });
  }
  if (reset) {
    return NextResponse.json({ ok: true, reset: true, pjn_cargado_at: null });
  }
  if (manual) {
    return NextResponse.json({ ok: true, manual: true, pjn_cargado_manual_at: marcarAt });
  }
  return NextResponse.json({ ok: true, pjn_cargado_at: marcarAt });
}
