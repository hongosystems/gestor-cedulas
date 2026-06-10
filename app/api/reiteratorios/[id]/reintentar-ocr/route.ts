import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import { procesarOcrEnBackground } from "@/lib/cedula-procesar-ocr";

export const runtime = "nodejs";
export const maxDuration = 300;

async function requireSuperadmin(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_superadmin === true;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede reintentar OCR en reiteratorios" },
      { status: 403 }
    );
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return NextResponse.json({ error: "ID de cédula requerido" }, { status: 400 });
  }

  const { data: cedula, error: fetchErr } = await svc
    .from("cedulas")
    .select("id, pdf_path, tipo_documento, pjn_cargado_at")
    .eq("id", cedulaId)
    .single();

  if (fetchErr || !cedula) {
    return NextResponse.json({ error: "Cédula no encontrada" }, { status: 404 });
  }

  if (cedula.tipo_documento !== "OFICIO") {
    return NextResponse.json(
      { error: "Solo se puede reintentar OCR sobre oficios" },
      { status: 400 }
    );
  }

  if (!cedula.pdf_path) {
    return NextResponse.json(
      { error: "El oficio no tiene archivo PDF asociado" },
      { status: 400 }
    );
  }

  const { error: marcarProcesandoErr } = await svc
    .from("cedulas")
    .update({ estado_ocr: "procesando", ocr_error: null })
    .eq("id", cedulaId);

  if (marcarProcesandoErr) {
    return NextResponse.json(
      { error: marcarProcesandoErr.message || "No se pudo marcar como procesando" },
      { status: 500 }
    );
  }

  after(() =>
    procesarOcrEnBackground(cedulaId, svc, {
      skipCargarPjn: !!cedula.pjn_cargado_at,
    })
  );

  return NextResponse.json({ ok: true, status: "procesando" });
}
