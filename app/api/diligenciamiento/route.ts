import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  DILIGENCIAMIENTO_FORBIDDEN_MSG,
  requireDiligenciamientoAccess,
} from "@/lib/diligenciamiento-access";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: "Sesión inválida o expirada. Volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  const svc = supabaseService();
  if (!(await requireDiligenciamientoAccess(user.id, svc))) {
    return NextResponse.json(
      { error: DILIGENCIAMIENTO_FORBIDDEN_MSG },
      { status: 403 }
    );
  }

  const { data: cedulas, error } = await svc
    .from("cedulas")
    .select(
      "id, caratula, juzgado, ocr_exp_nro, ocr_procesado_at, pdf_acredita_url, pjn_cargado_at, pjn_cargado_manual_at, tipo_documento, estado_ocr, observaciones_pjn"
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
