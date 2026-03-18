import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

type RequeridoPayload = {
  nombre: string;
  empresa_nombre_razon_social?: string;
  condicion?: string;
  domicilio?: string;
  lesiones?: string;
  es_aseguradora?: boolean;
  aseguradora_nombre?: string;
  aseguradora_domicilio?: string;
  orden?: number;
};

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

    const body = await req.json();
    const {
      estado = "borrador",
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
      requeridos = [],
    } = body;

    const { data: mediacion, error: insertError } = await svc
      .from("mediaciones")
      .insert({
        user_id: user.id,
        estado: estado || "borrador",
        letrado_nombre: letrado_nombre ?? null,
        letrado_caracter: letrado_caracter ?? null,
        letrado_tomo: letrado_tomo ?? null,
        letrado_folio: letrado_folio ?? null,
        letrado_domicilio: letrado_domicilio ?? null,
        letrado_telefono: letrado_telefono ?? null,
        letrado_celular: letrado_celular ?? null,
        letrado_email: letrado_email ?? null,
        req_nombre: req_nombre ?? null,
        req_dni: req_dni ?? null,
        req_domicilio: req_domicilio ?? null,
        req_email: req_email ?? null,
        req_celular: req_celular ?? null,
        objeto_reclamo: objeto_reclamo ?? null,
        fecha_hecho: fecha_hecho || null,
        lugar_hecho: lugar_hecho ?? null,
        vehiculo: vehiculo ?? null,
        dominio_patente: dominio_patente ?? null,
        nro_siniestro: nro_siniestro ?? null,
        nro_poliza: nro_poliza ?? null,
        mecanica_hecho: mecanica_hecho ?? null,
        linea_interno: linea_interno ?? null,
        articulo: articulo ?? null,
        intervino: intervino ?? null,
        lesiones_ambos: lesiones_ambos ?? null,
      })
      .select("id, numero_tramite, estado, created_at")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    if (requeridos.length > 0 && mediacion?.id) {
      const requeridosRows = (requeridos as RequeridoPayload[]).map((r, i) => ({
        mediacion_id: mediacion.id,
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
      await svc.from("mediacion_requeridos").insert(requeridosRows);
    }

    const estadoInicial = mediacion?.estado || "pendiente_rta";
    if (mediacion?.id) {
      await svc.from("mediacion_historial").insert({
        mediacion_id: mediacion.id,
        estado_anterior: null,
        estado_nuevo: estadoInicial,
        actor_id: user.id,
        comentario: "Alta de solicitud",
      });
    }

    return NextResponse.json({ ok: true, data: mediacion });
  } catch (e: any) {
    console.error("[mediaciones/create]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
