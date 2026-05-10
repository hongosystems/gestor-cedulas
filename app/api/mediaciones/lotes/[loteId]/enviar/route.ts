import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

async function getAccess(userId: string, svc: ReturnType<typeof supabaseService>) {
  const { isAdminMediaciones, isSuperadmin, isMediador } = await getMediacionesRole(userId, svc);
  return { isAdmin: isAdminMediaciones || isSuperadmin, isMediador };
}

async function mediadorOwnsEntireLote(loteId: string, userId: string, svc: ReturnType<typeof supabaseService>) {
  const { data: loteItems } = await svc
    .from("mediacion_lote_items")
    .select("mediacion_id, mediaciones!inner(user_id)")
    .eq("lote_id", loteId);
  if (!loteItems || loteItems.length === 0) return false;
  return loteItems.every((item: any) => item.mediaciones?.user_id === userId);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ loteId: string }> }
) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = supabaseService();
    const access = await getAccess(user.id, svc);
    if (!access.isAdmin && !access.isMediador) {
      return NextResponse.json({ error: "Sin permisos para mediaciones" }, { status: 403 });
    }

    const { loteId } = await params;
    if (!access.isAdmin) {
      const ownsLote = await mediadorOwnsEntireLote(loteId, user.id, svc);
      if (!ownsLote) {
        return NextResponse.json({ error: "No autorizado para este lote" }, { status: 403 });
      }
    }

    const { data: lote, error: loteErr } = await svc
      .from("mediacion_lotes")
      .select("id, estado, fecha_envio")
      .eq("id", loteId)
      .single();

    if (loteErr || !lote) {
      return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
    }
    if (lote.estado === "enviado") {
      return NextResponse.json({
        ok: true,
        data: { ...lote, message: "Lote ya estaba marcado como enviado" },
      });
    }

    const now = new Date().toISOString();

    const { data: updated, error: updateErr } = await svc
      .from("mediacion_lotes")
      .update({ estado: "enviado", fecha_envio: now })
      .eq("id", loteId)
      .select("*")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      data: updated,
      message: "Lote marcado como enviado. El envío efectivo de correos puede configurarse por cron o manual.",
    });
  } catch (e: any) {
    console.error("[mediaciones/lotes/[loteId]/enviar]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
