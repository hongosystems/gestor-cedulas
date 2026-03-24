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

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Soportar token por query (para window.open) o Authorization header
  const tokenFromQuery = req.nextUrl.searchParams.get("token");
  const reqWithAuth = tokenFromQuery
    ? new Request(req.url, { headers: { ...req.headers, authorization: `Bearer ${tokenFromQuery}` } })
    : req;
  const user = await getUserFromRequest(reqWithAuth);
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireAbogado(user.id, svc))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return new NextResponse("ID requerido", { status: 400 });
  }

  const { data: cedula, error: fetchErr } = await svc
    .from("cedulas")
    .select("id, juzgado, estado_ocr")
    .eq("id", cedulaId)
    .single();

  if (fetchErr || !cedula || cedula.estado_ocr !== "listo") {
    return new NextResponse("Cédula no encontrada o no lista", { status: 404 });
  }

  const { data: roleData } = await svc
    .from("user_roles")
    .select("is_superadmin")
    .eq("user_id", user.id)
    .maybeSingle();

  const isSuperadmin = roleData?.is_superadmin === true;
  if (!isSuperadmin) {
    const { data: juzgadosData } = await svc
      .from("user_juzgados")
      .select("juzgado")
      .eq("user_id", user.id);
    const juzgadosAsignados = (juzgadosData || []).map((j) =>
      (j.juzgado || "").trim().replace(/\s+/g, " ").toUpperCase()
    );
    const juzgadoCedula = (cedula.juzgado || "").trim().replace(/\s+/g, " ").toUpperCase();
    const tieneAcceso =
      juzgadosAsignados.length > 0 &&
      juzgadoCedula &&
      juzgadosAsignados.some(
        (j) =>
          j === juzgadoCedula ||
          (j.includes("JUZGADO") &&
            juzgadoCedula.includes("JUZGADO") &&
            j.match(/\d+/)?.[0] === juzgadoCedula.match(/\d+/)?.[0])
      );
    if (!tieneAcceso) {
      return new NextResponse("No tienes acceso a este juzgado", { status: 403 });
    }
  }

  const storagePath = `acredita/${cedulaId}.pdf`;
  const { data: fileData, error: downloadErr } = await svc.storage
    .from("cedulas")
    .download(storagePath);

  if (downloadErr || !fileData) {
    return new NextResponse("PDF no encontrado", { status: 404 });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="acredita-${cedulaId}.pdf"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
