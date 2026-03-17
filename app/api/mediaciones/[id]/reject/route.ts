import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

async function requireAdmin(
  userId: string,
  svc: ReturnType<typeof supabaseService>
) {
  const { isAdminMediaciones, isSuperadmin } = await getMediacionesRole(userId, svc);
  return isAdminMediaciones || isSuperadmin;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: mediacionId } = await params;
    const body = await req.json().catch(() => ({}));
    const texto = (body.texto || "").toString().trim();
    if (!texto) {
      return NextResponse.json({ error: "texto (observación) es requerido" }, { status: 400 });
    }

    const svc = supabaseService();
    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const { data: mediacion, error: medErr } = await svc
      .from("mediaciones")
      .select("id, estado")
      .eq("id", mediacionId)
      .single();

    if (medErr || !mediacion) {
      return NextResponse.json({ error: "Mediación no encontrada" }, { status: 404 });
    }

    const estadoAnterior = mediacion.estado;

    await svc.from("mediacion_observaciones").insert({
      mediacion_id: mediacionId,
      texto,
      autor_id: user.id,
    });

    await svc.from("mediacion_historial").insert({
      mediacion_id: mediacionId,
      estado_anterior: estadoAnterior,
      estado_nuevo: "devuelto",
      actor_id: user.id,
      comentario: texto.slice(0, 500),
    });

    const { data: updated, error: updateErr } = await svc
      .from("mediaciones")
      .update({ estado: "devuelto" })
      .eq("id", mediacionId)
      .select("*")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: updated });
  } catch (e: any) {
    console.error("[mediaciones/[id]/reject]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
