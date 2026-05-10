import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

async function getAccess(userId: string, svc: ReturnType<typeof supabaseService>) {
  const { isAdminMediaciones, isSuperadmin, isMediador } = await getMediacionesRole(userId, svc);
  return {
    isAdmin: isAdminMediaciones || isSuperadmin,
    isMediador,
  };
}

async function mediadorOwnsEntireLote(loteId: string, userId: string, svc: ReturnType<typeof supabaseService>) {
  const { data: loteItems } = await svc
    .from("mediacion_lote_items")
    .select("mediacion_id, mediaciones!inner(user_id)")
    .eq("lote_id", loteId);
  if (!loteItems || loteItems.length === 0) return false;
  return loteItems.every((item: any) => item.mediaciones?.user_id === userId);
}

export async function GET(
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

    const { data: lote, error: loteErr } = await svc
      .from("mediacion_lotes")
      .select("*")
      .eq("id", loteId)
      .single();

    if (loteErr || !lote) {
      return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
    }
    if (!access.isAdmin) {
      const ownsLote = await mediadorOwnsEntireLote(loteId, user.id, svc);
      if (!ownsLote) {
        return NextResponse.json({ error: "No autorizado para este lote" }, { status: 403 });
      }
    }

    const { data: items } = await svc
      .from("mediacion_lote_items")
      .select(`
        id,
        mediacion_id,
        documento_id,
        mediaciones:mediacion_id (id, numero_tramite, estado, req_nombre, objeto_reclamo)
      `)
      .eq("lote_id", loteId);

    return NextResponse.json({
      ok: true,
      data: { ...lote, items: items || [] },
    });
  } catch (e: any) {
    console.error("[mediaciones/lotes/[loteId]] GET", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
    const body = await req.json();

    const updatePayload: Record<string, unknown> = {};
    if (body.estado !== undefined) updatePayload.estado = body.estado;
    if (body.umbral !== undefined) updatePayload.umbral = body.umbral;
    if (body.destinatarios !== undefined) updatePayload.destinatarios = body.destinatarios;
    if (body.texto_mail !== undefined) updatePayload.texto_mail = body.texto_mail;
    if (body.envio_automatico !== undefined) updatePayload.envio_automatico = body.envio_automatico;
    if (body.fecha_envio !== undefined) updatePayload.fecha_envio = body.fecha_envio;

    if (Object.keys(updatePayload).length === 0) {
      const { data: lote } = await svc.from("mediacion_lotes").select("*").eq("id", loteId).single();
      return NextResponse.json({ ok: true, data: lote });
    }

    const { data: updated, error } = await svc
      .from("mediacion_lotes")
      .update(updatePayload)
      .eq("id", loteId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: updated });
  } catch (e: any) {
    console.error("[mediaciones/lotes/[loteId]] PATCH", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
