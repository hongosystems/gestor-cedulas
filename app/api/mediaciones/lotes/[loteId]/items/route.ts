import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

async function requireAdmin(userId: string, svc: ReturnType<typeof supabaseService>) {
  const { isAdminMediaciones, isSuperadmin } = await getMediacionesRole(userId, svc);
  return isAdminMediaciones || isSuperadmin;
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
    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const { loteId } = await params;
    const body = await req.json();
    const mediacionIds: string[] = Array.isArray(body.mediacion_ids) ? body.mediacion_ids : [];
    const documentoIdsMap: Record<string, string> = body.documento_ids || {};

    if (mediacionIds.length === 0) {
      return NextResponse.json({ error: "mediacion_ids es requerido (array)" }, { status: 400 });
    }

    const { data: lote } = await svc
      .from("mediacion_lotes")
      .select("id, estado")
      .eq("id", loteId)
      .single();

    if (!lote) {
      return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
    }
    if (lote.estado !== "abierto") {
      return NextResponse.json({ error: "Solo se pueden agregar ítems a lotes abiertos" }, { status: 400 });
    }

    const rows = mediacionIds.map((mediacion_id: string) => ({
      lote_id: loteId,
      mediacion_id,
      documento_id: documentoIdsMap[mediacion_id] || null,
    }));

    const { data: inserted, error } = await svc
      .from("mediacion_lote_items")
      .upsert(rows, { onConflict: "lote_id,mediacion_id", ignoreDuplicates: false })
      .select("id, lote_id, mediacion_id, documento_id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: inserted });
  } catch (e: any) {
    console.error("[mediaciones/lotes/[loteId]/items]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ loteId: string }> }
) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = supabaseService();
    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const { loteId } = await params;
    const mediacionId = req.nextUrl.searchParams.get("mediacion_id");

    if (!mediacionId) {
      return NextResponse.json({ error: "mediacion_id query es requerido" }, { status: 400 });
    }

    const { error } = await svc
      .from("mediacion_lote_items")
      .delete()
      .eq("lote_id", loteId)
      .eq("mediacion_id", mediacionId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[mediaciones/lotes/[loteId]/items] DELETE", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
