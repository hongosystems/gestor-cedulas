import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

async function canAccessMediacion(
  userId: string,
  mediacionUserId: string,
  svc: ReturnType<typeof supabaseService>
) {
  if (userId === mediacionUserId) return true;
  const { isAdminMediaciones, isSuperadmin } = await getMediacionesRole(userId, svc);
  return isAdminMediaciones || isSuperadmin;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const documentoId = req.nextUrl.searchParams.get("documento_id");
    const mediacionId = req.nextUrl.searchParams.get("mediacion_id");

    const svc = supabaseService();

    let storagePath: string;

    if (documentoId) {
      const { data: doc, error: docErr } = await svc
        .from("mediacion_documentos")
        .select("id, mediacion_id, storage_path")
        .eq("id", documentoId)
        .single();

      if (docErr || !doc) {
        return new NextResponse("Documento no encontrado", { status: 404 });
      }

      const { data: med } = await svc
        .from("mediaciones")
        .select("user_id")
        .eq("id", doc.mediacion_id)
        .single();

      if (!med) {
        return new NextResponse("Mediación no encontrada", { status: 404 });
      }

      const allowed = await canAccessMediacion(user.id, med.user_id, svc);
      if (!allowed) {
        return new NextResponse("No autorizado", { status: 403 });
      }

      storagePath = doc.storage_path;
    } else if (mediacionId) {
      const { data: med, error: medErr } = await svc
        .from("mediaciones")
        .select("id, user_id")
        .eq("id", mediacionId)
        .single();

      if (medErr || !med) {
        return new NextResponse("Mediación no encontrada", { status: 404 });
      }

      const allowed = await canAccessMediacion(user.id, med.user_id, svc);
      if (!allowed) {
        return new NextResponse("No autorizado", { status: 403 });
      }

      const { data: latest } = await svc
        .from("mediacion_documentos")
        .select("id, storage_path")
        .eq("mediacion_id", mediacionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latest) {
        return new NextResponse("No hay documento generado para esta mediación", { status: 404 });
      }

      storagePath = latest.storage_path;
    } else {
      return new NextResponse("Indique documento_id o mediacion_id", { status: 400 });
    }

    const { data: signed, error: signErr } = await svc.storage
      .from("mediaciones")
      .createSignedUrl(storagePath, 60 * 60);

    if (signErr || !signed?.signedUrl) {
      return new NextResponse("Error al generar enlace de descarga", { status: 500 });
    }

    return NextResponse.redirect(signed.signedUrl);
  } catch (e: any) {
    console.error("[mediaciones/download]", e);
    return new NextResponse("Error interno", { status: 500 });
  }
}
