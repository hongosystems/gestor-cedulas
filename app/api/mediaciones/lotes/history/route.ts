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

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = supabaseService();
    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const { data: lotes, error } = await svc
      .from("mediacion_lotes")
      .select("id, numero_lote, estado, umbral, destinatarios, texto_mail, fecha_envio, created_at")
      .eq("estado", "enviado")
      .order("fecha_envio", { ascending: false });

    if (error) {
      if (error.message?.includes("does not exist") || (error as any).code === "PGRST116") {
        return NextResponse.json({ ok: true, data: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const list = lotes || [];
    const loteIds = list.map((l: { id: string }) => l.id);
    const counts: Record<string, number> = {};
    if (loteIds.length > 0) {
      const { data: items } = await svc
        .from("mediacion_lote_items")
        .select("lote_id")
        .in("lote_id", loteIds);
      (items || []).forEach((r: { lote_id: string }) => {
        counts[r.lote_id] = (counts[r.lote_id] ?? 0) + 1;
      });
    }
    const data = list.map((l: { id: string; [k: string]: unknown }) => ({
      ...l,
      items_count: counts[l.id] ?? 0,
    }));

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("[mediaciones/lotes/history]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
