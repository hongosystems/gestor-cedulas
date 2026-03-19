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

export async function GET(
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

    const { data: mediacion, error: medErr } = await svc
      .from("mediaciones")
      .select("*")
      .eq("id", id)
      .single();

    if (medErr || !mediacion) {
      return NextResponse.json({ error: "Mediación no encontrada" }, { status: 404 });
    }

    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const [reqRes, obsRes, histRes, docRes] = await Promise.all([
      svc.from("mediacion_requeridos").select("*").eq("mediacion_id", id).order("orden"),
      svc.from("mediacion_observaciones").select("id, texto, autor_id, created_at").eq("mediacion_id", id).order("created_at", { ascending: false }),
      svc.from("mediacion_historial").select("id, estado_anterior, estado_nuevo, actor_id, comentario, created_at").eq("mediacion_id", id).order("created_at", { ascending: false }),
      svc.from("mediacion_documentos").select("id, tipo_plantilla, storage_path, modo_firma, created_at").eq("mediacion_id", id).order("created_at", { ascending: false }),
    ]);

    const autorIds = [...new Set((obsRes.data || []).map((o: any) => o.autor_id).filter(Boolean))];
    const actorIds = [...new Set((histRes.data || []).map((h: any) => h.actor_id).filter(Boolean))];
    const profileIds = [...new Set([...autorIds, ...actorIds])];
    let profiles: Record<string, { full_name?: string; email?: string }> = {};
    if (profileIds.length > 0) {
      const { data: profs } = await svc.from("profiles").select("id, full_name, email").in("id", profileIds);
      (profs || []).forEach((p: any) => { profiles[p.id] = p; });
    }

    const observaciones = (obsRes.data || []).map((o: any) => ({ ...o, autor: profiles[o.autor_id] || null }));
    const historial = (histRes.data || []).map((h: any) => ({ ...h, actor: profiles[h.actor_id] || null }));

    return NextResponse.json({
      ok: true,
      data: {
        ...mediacion,
        requeridos: reqRes.data || [],
        observaciones,
        historial,
        documentos: docRes.data || [],
      },
    });
  } catch (e: any) {
    console.error("[mediaciones/[id]] GET", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    const { data: existing } = await svc
      .from("mediaciones")
      .select("id, user_id, estado")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Mediación no encontrada" }, { status: 404 });
    }

    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const body = await req.json();
    const {
      estado,
      fecha_envio,
      tracking_externo_id,
      letrado_nombre,
      letrado_caracter,
      letrado_tomo,
      letrado_folio,
      letrado_domicilio,
      letrado_telefono,
      letrado_celular,
      letrado_email,
      req_nombre,
      req_dni,
      req_domicilio,
      req_email,
      req_celular,
      objeto_reclamo,
      fecha_hecho,
      lugar_hecho,
      vehiculo,
      dominio_patente,
      nro_siniestro,
      nro_poliza,
      mecanica_hecho,
      linea_interno,
      articulo,
      intervino,
      lesiones_ambos,
      requeridos,
    } = body;

    const updatePayload: Record<string, unknown> = {};
    if (estado !== undefined) updatePayload.estado = estado;
    if (fecha_envio !== undefined) updatePayload.fecha_envio = fecha_envio;
    if (tracking_externo_id !== undefined) updatePayload.tracking_externo_id = tracking_externo_id;
    if (letrado_nombre !== undefined) updatePayload.letrado_nombre = letrado_nombre;
    if (letrado_caracter !== undefined) updatePayload.letrado_caracter = letrado_caracter;
    if (letrado_tomo !== undefined) updatePayload.letrado_tomo = letrado_tomo;
    if (letrado_folio !== undefined) updatePayload.letrado_folio = letrado_folio;
    if (letrado_domicilio !== undefined) updatePayload.letrado_domicilio = letrado_domicilio;
    if (letrado_telefono !== undefined) updatePayload.letrado_telefono = letrado_telefono;
    if (letrado_celular !== undefined) updatePayload.letrado_celular = letrado_celular;
    if (letrado_email !== undefined) updatePayload.letrado_email = letrado_email;
    if (req_nombre !== undefined) updatePayload.req_nombre = req_nombre;
    if (req_dni !== undefined) updatePayload.req_dni = req_dni;
    if (req_domicilio !== undefined) updatePayload.req_domicilio = req_domicilio;
    if (req_email !== undefined) updatePayload.req_email = req_email;
    if (req_celular !== undefined) updatePayload.req_celular = req_celular;
    if (objeto_reclamo !== undefined) updatePayload.objeto_reclamo = objeto_reclamo;
    if (fecha_hecho !== undefined) updatePayload.fecha_hecho = fecha_hecho || null;
    if (lugar_hecho !== undefined) updatePayload.lugar_hecho = lugar_hecho;
    if (vehiculo !== undefined) updatePayload.vehiculo = vehiculo;
    if (dominio_patente !== undefined) updatePayload.dominio_patente = dominio_patente;
    if (nro_siniestro !== undefined) updatePayload.nro_siniestro = nro_siniestro;
    if (nro_poliza !== undefined) updatePayload.nro_poliza = nro_poliza;
    if (mecanica_hecho !== undefined) updatePayload.mecanica_hecho = mecanica_hecho;
    if (linea_interno !== undefined) updatePayload.linea_interno = linea_interno;
    if (articulo !== undefined) updatePayload.articulo = articulo;
    if (intervino !== undefined) updatePayload.intervino = intervino;
    if (lesiones_ambos !== undefined) updatePayload.lesiones_ambos = lesiones_ambos;

    if (estado !== undefined && estado !== existing.estado) {
      await svc.from("mediacion_historial").insert({
        mediacion_id: id,
        estado_anterior: existing.estado,
        estado_nuevo: estado,
        actor_id: user.id,
      });
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateErr } = await svc
        .from("mediaciones")
        .update(updatePayload)
        .eq("id", id);
      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
    }

    if (Array.isArray(requeridos)) {
      await svc.from("mediacion_requeridos").delete().eq("mediacion_id", id);
      if (requeridos.length > 0) {
        const rows = requeridos.map((r: any, i: number) => ({
          mediacion_id: id,
          nombre: r.nombre ?? "",
          empresa_nombre_razon_social: r.empresa_nombre_razon_social ?? null,
          condicion: r.condicion ?? null,
          domicilio: r.domicilio ?? null,
          lesiones: r.lesiones ?? null,
          es_aseguradora: r.es_aseguradora === true,
          aseguradora_nombre: r.aseguradora_nombre ?? null,
          aseguradora_domicilio: r.aseguradora_domicilio ?? null,
          orden: r.orden ?? i,
        }));
        await svc.from("mediacion_requeridos").insert(rows);
      }
    }

    const { data: updated } = await svc.from("mediaciones").select("*").eq("id", id).single();
    return NextResponse.json({ ok: true, data: updated });
  } catch (e: any) {
    console.error("[mediaciones/[id]] PATCH", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const { data: existing, error: existingErr } = await svc.from("mediaciones").select("id").eq("id", id).single();
    if (existingErr || !existing) {
      return NextResponse.json({ error: "Mediación no encontrada" }, { status: 404 });
    }

    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const { error: deleteErr } = await svc.from("mediaciones").delete().eq("id", id);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[mediaciones/[id]] DELETE", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
