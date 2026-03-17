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

    const { id } = await params;
    const svc = supabaseService();
    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const { data: mediacion, error: medErr } = await svc
      .from("mediaciones")
      .select("id, estado")
      .eq("id", id)
      .single();

    if (medErr || !mediacion) {
      return NextResponse.json({ error: "Mediación no encontrada" }, { status: 404 });
    }

    const estadoAnterior = mediacion.estado;
    if (estadoAnterior === "aceptado") {
      return NextResponse.json({ ok: true, data: mediacion, message: "Ya estaba aceptada" });
    }

    await svc.from("mediacion_historial").insert({
      mediacion_id: id,
      estado_anterior: estadoAnterior,
      estado_nuevo: "aceptado",
      actor_id: user.id,
      comentario: "Mediación aceptada",
    });

    const { data: updated, error: updateErr } = await svc
      .from("mediaciones")
      .update({ estado: "aceptado" })
      .eq("id", id)
      .select("*")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: updated });
  } catch (e: any) {
    console.error("[mediaciones/[id]/accept]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
