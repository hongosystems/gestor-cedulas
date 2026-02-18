import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  try {
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    if (!url || !anon) {
      return null;
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const { data: { user }, error } = await supabaseClient.auth.getUser(token);
    
    if (error || !user) {
      return null;
    }

    return user;
  } catch (e: any) {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      entidad_tipo, // 'ORDEN' o 'GESTION'
      entidad_id,
      canal,
      resultado,
      motivo_falla,
      detalle,
      actualizar_estado, // Opcional: si se debe actualizar el estado de la gestión
      nuevo_estado, // Opcional: nuevo estado si actualizar_estado es true
    } = await req.json();

    if (!entidad_tipo || !entidad_id || !canal || !resultado || !detalle) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: entidad_tipo, entidad_id, canal, resultado, detalle" },
        { status: 400 }
      );
    }

    if (!["ORDEN", "GESTION"].includes(entidad_tipo)) {
      return NextResponse.json(
        { error: "entidad_tipo debe ser 'ORDEN' o 'GESTION'" },
        { status: 400 }
      );
    }

    if (!["SATISFACTORIO", "INSATISFACTORIO", "SIN_RESPUESTA", "RECHAZO"].includes(resultado)) {
      return NextResponse.json(
        { error: "resultado inválido" },
        { status: 400 }
      );
    }

    const svc = supabaseService();

    // Verificar que la entidad existe y el usuario tiene acceso
    if (entidad_tipo === "ORDEN") {
      const { data: orden, error: ordenError } = await svc
        .from("ordenes_medicas")
        .select("id, emitida_por_user_id, expediente_id")
        .eq("id", entidad_id)
        .single();

      if (ordenError || !orden) {
        return NextResponse.json(
          { error: "Orden no encontrada" },
          { status: 404 }
        );
      }

      // Verificar permisos
      let tieneAcceso = orden.emitida_por_user_id === user.id;
      if (!tieneAcceso && orden.expediente_id) {
        const { data: expediente } = await svc
          .from("expedientes")
          .select("owner_user_id")
          .eq("id", orden.expediente_id)
          .single();

        if (expediente && expediente.owner_user_id === user.id) {
          tieneAcceso = true;
        }
      }

      if (!tieneAcceso) {
        const { data: roleData } = await svc
          .from("user_roles")
          .select("is_superadmin, is_admin_expedientes")
          .eq("user_id", user.id)
          .maybeSingle();

        if (roleData?.is_superadmin || roleData?.is_admin_expedientes) {
          tieneAcceso = true;
        }
      }

      if (!tieneAcceso) {
        return NextResponse.json(
          { error: "No autorizado" },
          { status: 403 }
        );
      }
    } else if (entidad_tipo === "GESTION") {
      const { data: gestion, error: gestionError } = await svc
        .from("gestiones_estudio")
        .select("id, responsable_user_id, orden_id")
        .eq("id", entidad_id)
        .single();

      if (gestionError || !gestion) {
        return NextResponse.json(
          { error: "Gestión no encontrada" },
          { status: 404 }
        );
      }

      // Verificar permisos
      let tieneAcceso = gestion.responsable_user_id === user.id;

      if (!tieneAcceso && gestion.orden_id) {
        const { data: orden } = await svc
          .from("ordenes_medicas")
          .select("emitida_por_user_id")
          .eq("id", gestion.orden_id)
          .single();

        if (orden && orden.emitida_por_user_id === user.id) {
          tieneAcceso = true;
        }
      }

      if (!tieneAcceso) {
        const { data: roleData } = await svc
          .from("user_roles")
          .select("is_superadmin, is_admin_expedientes")
          .eq("user_id", user.id)
          .maybeSingle();

        if (roleData?.is_superadmin || roleData?.is_admin_expedientes) {
          tieneAcceso = true;
        }
      }

      if (!tieneAcceso) {
        return NextResponse.json(
          { error: "No autorizado" },
          { status: 403 }
        );
      }
    }

    // Crear comunicación
    const { data: comunicacion, error: comError } = await svc
      .from("comunicaciones")
      .insert({
        entidad_tipo,
        entidad_id,
        canal,
        resultado,
        motivo_falla: motivo_falla || null,
        detalle: detalle.trim(),
        realizado_por_user_id: user.id,
      })
      .select()
      .single();

    if (comError) {
      console.error("Error creando comunicación:", comError);
      return NextResponse.json(
        { error: "Error al crear comunicación: " + comError.message },
        { status: 500 }
      );
    }

    // Si se solicita actualizar estado de la gestión
    if (actualizar_estado && entidad_tipo === "GESTION" && nuevo_estado) {
      const { error: updateError } = await svc
        .from("gestiones_estudio")
        .update({ estado: nuevo_estado })
        .eq("id", entidad_id);

      if (updateError) {
        console.error("Error actualizando estado:", updateError);
        // No fallar, solo loguear
      }
    }

    return NextResponse.json({
      ok: true,
      data: comunicacion,
    });
  } catch (e: any) {
    console.error("Error en comunicacion:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
