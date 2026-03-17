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

    const { data: lotes, error } = await svc
      .from("mediacion_lotes")
      .select("id, numero_lote, estado, umbral, destinatarios, texto_mail, envio_automatico, fecha_envio, created_at")
      .order("numero_lote", { ascending: false });

    if (error) {
      if (error.message?.includes("does not exist") || error.code === "PGRST116") {
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
    console.error("[mediaciones/lotes] GET", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
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

    const body = await req.json().catch(() => ({}));
    const umbral = body.umbral ?? 56;
    const destinatarios = Array.isArray(body.destinatarios) && body.destinatarios.length > 0
      ? body.destinatarios
      : ["oliverarodrigo86@gmail.com", "gfhisi@gmail.com"];
    const texto_mail = body.texto_mail ?? `¿Como estan? Solicito fecha de mediacion . 

Tratar con Magaly Flores (mf.magaliflores@gmail.com) que es quien asiste a las audiencias.  

Adjunto los seis formularios.

Saludos Cordiales.`;
    const envio_automatico = body.envio_automatico === true;

    const { data: maxRow } = await svc
      .from("mediacion_lotes")
      .select("numero_lote")
      .order("numero_lote", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextNumero = (maxRow?.numero_lote ?? 0) + 1;

    const { data: lote, error } = await svc
      .from("mediacion_lotes")
      .insert({
        numero_lote: nextNumero,
        estado: "abierto",
        umbral,
        destinatarios,
        texto_mail,
        envio_automatico,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: lote });
  } catch (e: any) {
    console.error("[mediaciones/lotes] POST", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
