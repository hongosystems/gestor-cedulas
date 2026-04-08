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

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireAbogado(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo abogados pueden cargar en PJN" },
      { status: 403 }
    );
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return NextResponse.json({ error: "ID de cédula requerido" }, { status: 400 });
  }

  const { data: cedula, error: fetchErr } = await svc
    .from("cedulas")
    .select("id, estado_ocr, juzgado")
    .eq("id", cedulaId)
    .single();

  if (fetchErr || !cedula) {
    return NextResponse.json({ error: "Cédula no encontrada" }, { status: 404 });
  }

  if (cedula.estado_ocr !== "listo") {
    return NextResponse.json(
      { error: "La cédula no está lista para diligenciamiento" },
      { status: 400 }
    );
  }

  // Verificar acceso por juzgado (abogado debe tener juzgado asignado)
  const { data: juzgadosData } = await svc
    .from("user_juzgados")
    .select("juzgado")
    .eq("user_id", user.id);

  const juzgadosAsignados = (juzgadosData || []).map((j) =>
    (j.juzgado || "").trim().replace(/\s+/g, " ").toUpperCase()
  );
  const juzgadoCedula = (cedula.juzgado || "").trim().replace(/\s+/g, " ").toUpperCase();

  const { data: roleData } = await svc
    .from("user_roles")
    .select("is_superadmin")
    .eq("user_id", user.id)
    .maybeSingle();

  const isSuperadmin = roleData?.is_superadmin === true;
  const tieneAcceso =
    isSuperadmin ||
    (juzgadosAsignados.length > 0 &&
      juzgadoCedula &&
      juzgadosAsignados.some((j) => j === juzgadoCedula || (j.includes("JUZGADO") && juzgadoCedula.includes("JUZGADO") && j.match(/\d+/)?.[0] === juzgadoCedula.match(/\d+/)?.[0])));

  if (!tieneAcceso) {
    return NextResponse.json(
      { error: "No tienes acceso al juzgado de esta cédula" },
      { status: 403 }
    );
  }

  const pjn_cargado_at = new Date().toISOString();
  const pjn_cargado_por = user.id;

  let updateErr = (
    await svc
      .from("cedulas")
      .update({ pjn_cargado_at, pjn_cargado_por })
      .eq("id", cedulaId)
  ).error;

  if (updateErr && updateErr.message?.includes("pjn_cargado_por")) {
    const retry = await svc
      .from("cedulas")
      .update({ pjn_cargado_at })
      .eq("id", cedulaId);
    updateErr = retry.error;
  }

  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message || "Error al marcar como cargada" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
