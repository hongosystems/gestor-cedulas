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

    const { data: lote, error: loteErr } = await svc
      .from("mediacion_lotes")
      .select("id, numero_lote, estado, umbral, destinatarios, texto_mail, envio_automatico, created_at")
      .eq("estado", "abierto")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (loteErr) {
      if (loteErr.message?.includes("does not exist") || (loteErr as any).code === "PGRST116") {
        return NextResponse.json({ ok: true, data: null });
      }
      return NextResponse.json({ error: loteErr.message }, { status: 500 });
    }

    if (!lote) {
      return NextResponse.json({ ok: true, data: null });
    }

    const { data: items, error: itemsErr } = await svc
      .from("mediacion_lote_items")
      .select("id, mediacion_id, documento_id")
      .eq("lote_id", lote.id)
      .order("created_at", { ascending: true });

    if (itemsErr) {
      return NextResponse.json({ ok: true, data: { ...lote, items: [] } });
    }

    const itemsWithMediacion = items || [];
    const mediacionIds = [...new Set(itemsWithMediacion.map((i: any) => i.mediacion_id).filter(Boolean))];
    let mediaciones: Record<string, any> = {};
    if (mediacionIds.length > 0) {
      const { data: meds } = await svc
        .from("mediaciones")
        .select("id, numero_tramite, req_nombre, estado")
        .in("id", mediacionIds);
      (meds || []).forEach((m: any) => { mediaciones[m.id] = m; });
    }

    const itemsEnriched = itemsWithMediacion.map((i: any) => ({
      ...i,
      mediacion: mediaciones[i.mediacion_id] || null,
    }));

    return NextResponse.json({
      ok: true,
      data: { ...lote, items: itemsEnriched },
    });
  } catch (e: any) {
    console.error("[mediaciones/lotes/current]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
