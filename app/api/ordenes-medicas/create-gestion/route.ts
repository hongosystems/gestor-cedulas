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
      console.error("[create-gestion] No autorizado - usuario no encontrado");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[create-gestion] Usuario autenticado:", user.id);

    const body = await req.json();
    console.log("[create-gestion] Body recibido:", body);

    const {
      orden_id,
      responsable_user_id,
    } = body;

    if (!orden_id) {
      console.error("[create-gestion] Falta orden_id");
      return NextResponse.json(
        { error: "Falta orden_id" },
        { status: 400 }
      );
    }

    console.log("[create-gestion] Creando gestión para orden:", orden_id);

    const svc = supabaseService();

    // Verificar que la orden existe y el usuario tiene acceso
    const { data: orden, error: ordenError } = await svc
      .from("ordenes_medicas")
      .select("id, emitida_por_user_id, expediente_id")
      .eq("id", orden_id)
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

    // Verificar si ya existe una gestión
    const { data: gestionExistente, error: checkError } = await svc
      .from("gestiones_estudio")
      .select("id, estado, responsable_user_id")
      .eq("orden_id", orden_id)
      .maybeSingle();

    if (checkError) {
      console.error("[create-gestion] Error verificando gestión existente:", checkError);
      // Continuar, puede ser que la tabla no exista aún
    }

    if (gestionExistente) {
      console.log("[create-gestion] Ya existe gestión:", gestionExistente.id);
      // En lugar de error, retornar la gestión existente
      return NextResponse.json({
        ok: true,
        data: gestionExistente,
        warning: "La gestión ya existía",
      });
    }

    // Buscar usuario "Andrea" si no se especifica responsable
    let responsableId = responsable_user_id || user.id;
    if (!responsable_user_id) {
      try {
        const { data: andreaProfile } = await svc
          .from("profiles")
          .select("id")
          .or("full_name.ilike.%andrea%,email.ilike.%andrea%")
          .limit(1)
          .maybeSingle();

        if (andreaProfile) {
          responsableId = andreaProfile.id;
        }
      } catch (e) {
        // Si no se encuentra, usar usuario actual
      }
    }

    // Crear gestión
    const { data: gestion, error: gestionError } = await svc
      .from("gestiones_estudio")
      .insert({
        orden_id,
        estado: "PENDIENTE_CONTACTO_CLIENTE",
        responsable_user_id: responsableId,
      })
      .select()
      .single();

    if (gestionError) {
      console.error("Error creando gestión:", gestionError);
      return NextResponse.json(
        { error: "Error al crear gestión: " + gestionError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: gestion,
    });
  } catch (e: any) {
    console.error("Error en create-gestion:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
