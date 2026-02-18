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
      gestion_id,
      estado,
      centro_medico,
      turno_fecha_hora,
      fecha_estudio_realizado,
      generar_notificacion, // Si se debe generar notificación al marcar ESTUDIO_REALIZADO
    } = await req.json();

    if (!gestion_id || !estado) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: gestion_id, estado" },
        { status: 400 }
      );
    }

    const estadosValidos = [
      "PENDIENTE_CONTACTO_CLIENTE",
      "CONTACTO_CLIENTE_FALLIDO",
      "CONTACTO_CLIENTE_OK",
      "TURNO_CONFIRMADO",
      "SEGUIMIENTO_PRE_TURNO",
      "ESTUDIO_REALIZADO",
      "CANCELADA",
    ];

    if (!estadosValidos.includes(estado)) {
      return NextResponse.json(
        { error: "Estado inválido" },
        { status: 400 }
      );
    }

    const svc = supabaseService();

    // Obtener la gestión y verificar permisos
    const { data: gestion, error: gestionError } = await svc
      .from("gestiones_estudio")
      .select("id, orden_id, responsable_user_id, estado")
      .eq("id", gestion_id)
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

    // Preparar datos de actualización
    const updateData: any = {
      estado,
    };

    if (centro_medico !== undefined) {
      updateData.centro_medico = centro_medico || null;
    }

    if (turno_fecha_hora !== undefined) {
      updateData.turno_fecha_hora = turno_fecha_hora || null;
    }

    if (fecha_estudio_realizado !== undefined) {
      updateData.fecha_estudio_realizado = fecha_estudio_realizado || null;
    }

    // Actualizar gestión
    const { data: gestionActualizada, error: updateError } = await svc
      .from("gestiones_estudio")
      .update(updateData)
      .eq("id", gestion_id)
      .select()
      .single();

    if (updateError) {
      console.error("Error actualizando gestión:", updateError);
      return NextResponse.json(
        { error: "Error al actualizar: " + updateError.message },
        { status: 500 }
      );
    }

    // Si se marca como ESTUDIO_REALIZADO y se solicita notificación
    if (estado === "ESTUDIO_REALIZADO" && generar_notificacion) {
      try {
        // Obtener información de la orden
        const { data: orden } = await svc
          .from("ordenes_medicas")
          .select("id, case_ref, emitida_por_user_id")
          .eq("id", gestion.orden_id)
          .single();

        if (orden) {
          // Buscar usuario "Francisco" para notificar
          const { data: franciscoProfile } = await svc
            .from("profiles")
            .select("id, full_name, email")
            .or("full_name.ilike.%francisco%,email.ilike.%francisco%")
            .limit(1)
            .maybeSingle();

          const notificarA = franciscoProfile?.id || orden.emitida_por_user_id;

          // Obtener nombre del usuario actual
          const { data: currentUserProfile } = await svc
            .from("profiles")
            .select("full_name, email")
            .eq("id", user.id)
            .single();

          const currentUserName = currentUserProfile?.full_name || currentUserProfile?.email || "Un usuario";

          // Crear notificación usando el endpoint existente
          const { createClient } = await import("@supabase/supabase-js");
          const supabaseClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { auth: { persistSession: false } }
          );

          // Obtener token del usuario actual (simular para service role)
          // Usar service role directamente para crear notificación
          await svc.from("notifications").insert({
            user_id: notificarA,
            title: `Estudio realizado - ${orden.case_ref}`,
            body: `${currentUserName} marcó el estudio como realizado para la orden médica del caso ${orden.case_ref}`,
            link: `/prueba-pericia?tab=ordenes&orden_id=${orden.id}`,
            expediente_id: orden.id,
            is_pjn_favorito: false,
            metadata: {
              orden_id: orden.id,
              gestion_id: gestion_id,
              tipo: "ESTUDIO_REALIZADO",
            },
          });
        }
      } catch (notifError) {
        console.error("Error creando notificación:", notifError);
        // No fallar, solo loguear
      }
    }

    return NextResponse.json({
      ok: true,
      data: gestionActualizada,
    });
  } catch (e: any) {
    console.error("Error en update-estado:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
