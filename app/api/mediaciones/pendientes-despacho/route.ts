import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = supabaseService();
    const { isAdminMediaciones, isSuperadmin } = await getMediacionesRole(user.id, svc);
    if (!isAdminMediaciones && !isSuperadmin) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const { data: mediaciones } = await svc
      .from("mediaciones")
      .select("id, numero_tramite, req_nombre, objeto_reclamo, created_at")
      .eq("estado", "doc_generado")
      .order("created_at", { ascending: false });

    const { data: lotesEnviados } = await svc
      .from("mediacion_lotes")
      .select("id")
      .eq("estado", "enviado");
    const loteIds = (lotesEnviados || []).map((l: any) => l.id);
    let yaEnviados = new Set<string>();
    if (loteIds.length > 0) {
      const { data: itemsEnviados } = await svc
        .from("mediacion_lote_items")
        .select("mediacion_id")
        .in("lote_id", loteIds);
      (itemsEnviados || []).forEach((i: any) => yaEnviados.add(i.mediacion_id));
    }

    const pendientes = (mediaciones || []).filter((m) => !yaEnviados.has(m.id));

    return NextResponse.json({ ok: true, data: pendientes });
  } catch (e: any) {
    console.error("[mediaciones/pendientes-despacho]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
