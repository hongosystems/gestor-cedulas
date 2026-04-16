import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";

export const runtime = "nodejs";

async function requireAbogado(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_abogado, is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_abogado === true || data?.is_superadmin === true;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireAbogado(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo abogados pueden acceder a Diligenciamiento" },
      { status: 403 }
    );
  }

  const { data: cedulas, error } = await svc
    .from("cedulas")
    .select(
      "id, caratula, juzgado, ocr_exp_nro, ocr_procesado_at, pdf_acredita_url, pjn_cargado_at, tipo_documento, estado_ocr, observaciones_pjn"
    )
    .in("estado_ocr", ["listo", "procesando"])
    .or("tipo_documento.eq.CEDULA,tipo_documento.eq.OFICIO,tipo_documento.is.null")
    .order("ocr_procesado_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Error al listar cédulas" },
      { status: 500 }
    );
  }

  return NextResponse.json({ cedulas: cedulas ?? [] });
}
