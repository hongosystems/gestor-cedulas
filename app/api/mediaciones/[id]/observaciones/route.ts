import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

async function canAccessMediacion(
  userId: string,
  mediacionUserId: string,
  svc: ReturnType<typeof supabaseService>
) {
  if (userId === mediacionUserId) return true;
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
    const body = await req.json();
    const texto = (body.texto || "").toString().trim();
    if (!texto) {
      return NextResponse.json({ error: "texto es requerido" }, { status: 400 });
    }

    const svc = supabaseService();
    const { data: mediacion } = await svc
      .from("mediaciones")
      .select("id, user_id")
      .eq("id", mediacionId)
      .single();

    if (!mediacion) {
      return NextResponse.json({ error: "Mediación no encontrada" }, { status: 404 });
    }

    const allowed = await canAccessMediacion(user.id, mediacion.user_id, svc);
    if (!allowed) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { data: obs, error } = await svc
      .from("mediacion_observaciones")
      .insert({
        mediacion_id: mediacionId,
        texto,
        autor_id: user.id,
      })
      .select("id, texto, autor_id, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: obs });
  } catch (e: any) {
    console.error("[mediaciones/[id]/observaciones]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
