import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import { STORAGE_BUCKET, requireSuperadmin } from "@/lib/auditoria-tipo-documento-pdf";

export const runtime = "nodejs";

/**
 * GET /api/admin/auditoria-tipo-documento-pdf/:cedulaId/pdf
 *
 * Solo superadmin. Solo lectura.
 * Devuelve el PDF original (cedulas.pdf_path) — el que fue auditado.
 *
 * Acepta token por query (?token=...) para window.open desde la UI.
 *
 * Nota: deliberadamente NO usa /api/diligenciamiento/[id]/pdf porque éste exige
 * estado_ocr='listo' y access por juzgado. La auditoría es transversal.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const tokenFromQuery = req.nextUrl.searchParams.get("token");
  const reqWithAuth = tokenFromQuery
    ? new Request(req.url, {
        headers: { ...req.headers, authorization: `Bearer ${tokenFromQuery}` },
      })
    : req;
  const user = await getUserFromRequest(reqWithAuth);
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return new NextResponse("ID requerido", { status: 400 });
  }

  const { data: cedula, error: fetchErr } = await svc
    .from("cedulas")
    .select("id, pdf_path")
    .eq("id", cedulaId)
    .single();

  if (fetchErr || !cedula?.pdf_path) {
    return new NextResponse("Cédula sin PDF", { status: 404 });
  }

  const { data: fileData, error: downloadErr } = await svc.storage
    .from(STORAGE_BUCKET)
    .download(cedula.pdf_path);

  if (downloadErr || !fileData) {
    return new NextResponse("PDF no encontrado en Storage", { status: 404 });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="auditoria-${cedulaId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
