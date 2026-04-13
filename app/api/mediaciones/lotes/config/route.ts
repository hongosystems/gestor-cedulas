import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

const DEFAULT_CONFIG = {
  umbral: 56,
  destinatarios: [
    "oliverarodrigo86@gmail.com",
    "gfhisi@gmail.com",
    "mf.magaliflores@gmail.com",
    "audiencias@estudiobustinduy.com",
  ],
  texto_mail: `¿Como estan? Solicito fecha de mediacion . 

Tratar con Magaly Flores (mf.magaliflores@gmail.com) que es quien asiste a las audiencias.  

Adjunto los seis formularios.

Saludos Cordiales.`,
  envio_automatico: false,
};

async function requireAdmin(
  userId: string,
  svc: ReturnType<typeof supabaseService>
) {
  const { isAdminMediaciones, isSuperadmin } = await getMediacionesRole(userId, svc);
  return isAdminMediaciones || isSuperadmin;
}

async function getOpenLote(svc: ReturnType<typeof supabaseService>) {
  const { data } = await svc
    .from("mediacion_lotes")
    .select("id, numero_lote, estado, umbral, destinatarios, texto_mail, envio_automatico")
    .eq("estado", "abierto")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
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

    const lote = await getOpenLote(svc);
    if (!lote) {
      return NextResponse.json({ ok: true, data: DEFAULT_CONFIG });
    }

    return NextResponse.json({
      ok: true,
      data: {
        umbral: lote.umbral,
        destinatarios: lote.destinatarios ?? DEFAULT_CONFIG.destinatarios,
        texto_mail: lote.texto_mail ?? DEFAULT_CONFIG.texto_mail,
        envio_automatico: lote.envio_automatico ?? false,
        lote_id: lote.id,
        numero_lote: lote.numero_lote,
      },
    });
  } catch (e: any) {
    console.error("[mediaciones/lotes/config] GET", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = supabaseService();
    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const umbral = typeof body.umbral === "number" ? body.umbral : DEFAULT_CONFIG.umbral;
    const destinatarios = Array.isArray(body.destinatarios) && body.destinatarios.length > 0
      ? body.destinatarios
      : DEFAULT_CONFIG.destinatarios;
    const texto_mail = typeof body.texto_mail === "string" ? body.texto_mail : DEFAULT_CONFIG.texto_mail;
    const envio_automatico = body.envio_automatico === true;

    let lote = await getOpenLote(svc);

    if (!lote) {
      const { data: maxRow } = await svc
        .from("mediacion_lotes")
        .select("numero_lote")
        .order("numero_lote", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextNumero = (maxRow?.numero_lote ?? 0) + 1;
      const { data: created, error: createErr } = await svc
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
      if (createErr) {
        return NextResponse.json({ error: createErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, data: created });
    }

    const { data: updated, error: updateErr } = await svc
      .from("mediacion_lotes")
      .update({ umbral, destinatarios, texto_mail, envio_automatico })
      .eq("id", lote.id)
      .select("*")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: updated });
  } catch (e: any) {
    console.error("[mediaciones/lotes/config] PUT", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
