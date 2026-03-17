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

    const estado = req.nextUrl.searchParams.get("estado");
    const busqueda = req.nextUrl.searchParams.get("busqueda")?.trim() || req.nextUrl.searchParams.get("q")?.trim();

    let query = svc
      .from("mediaciones")
      .select(`
        id,
        numero_tramite,
        estado,
        user_id,
        created_at,
        fecha_envio,
        fecha_ultima_actualizacion,
        letrado_nombre,
        req_nombre,
        req_email,
        objeto_reclamo,
        fecha_hecho
      `)
      .order("created_at", { ascending: false });

    if (estado && estado.trim() !== "") {
      query = query.eq("estado", estado.trim());
    }

    if (busqueda) {
      query = query.or(
        `req_nombre.ilike.%${busqueda}%,numero_tramite.ilike.%${busqueda}%,req_email.ilike.%${busqueda}%`
      );
    }

    const { data: rows, error } = await query;

    if (error) {
      if (error.message?.includes("does not exist") || error.code === "PGRST116") {
        return NextResponse.json({ ok: true, data: [], warning: "Tabla mediaciones no existe. Ejecutar migración." });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: rows || [] });
  } catch (e: any) {
    console.error("[mediaciones/list]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
