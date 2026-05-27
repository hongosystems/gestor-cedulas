import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import { procesarOcrEnBackground } from "@/lib/cedula-procesar-ocr";

export const runtime = "nodejs";

export const maxDuration = 300;

async function requireAdminCedulas(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_admin_cedulas, is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_admin_cedulas === true || data?.is_superadmin === true;
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
  const isAdmin = await requireAdminCedulas(user.id, svc);
  if (!isAdmin) {
    return NextResponse.json(
      { error: "Solo usuarios con rol admin cédulas pueden procesar OCR" },
      { status: 403 }
    );
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return NextResponse.json({ error: "ID de cédula requerido" }, { status: 400 });
  }

  const { data: cedula, error: fetchErr } = await svc
    .from("cedulas")
    .select("id, pdf_path, tipo_documento")
    .eq("id", cedulaId)
    .single();

  if (fetchErr || !cedula) {
    return NextResponse.json(
      { error: "Cédula no encontrada" },
      { status: 404 }
    );
  }

  if (!cedula.pdf_path) {
    return NextResponse.json(
      { error: "La cédula no tiene archivo PDF asociado" },
      { status: 400 }
    );
  }

  const tipoValido = ["CEDULA", "OFICIO"].includes(
    String(cedula.tipo_documento || "").trim().toUpperCase()
  );
  if (!tipoValido) {
    console.warn("[tipo-doc-guard] bloqueo OCR por tipo_documento inválido", {
      cedulaId,
      tipo_documento: cedula.tipo_documento,
    });
    await svc
      .from("cedulas")
      .update({
        estado_ocr: "error",
        ocr_error: "tipo_documento inválido o vacío",
      })
      .eq("id", cedulaId);
    return NextResponse.json(
      { error: "tipo_documento inválido o vacío" },
      { status: 400 }
    );
  }

  const { error: marcarProcesandoErr } = await svc
    .from("cedulas")
    .update({ estado_ocr: "procesando" })
    .eq("id", cedulaId);

  if (marcarProcesandoErr) {
    return NextResponse.json(
      { error: marcarProcesandoErr.message || "No se pudo marcar como procesando" },
      { status: 500 }
    );
  }

  after(() => procesarOcrEnBackground(cedulaId, svc));

  return NextResponse.json({ ok: true, status: "procesando" });
}
