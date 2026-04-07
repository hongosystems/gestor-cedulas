import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Temporalmente sin auth para acceso desde la extensión Chrome
  // const user = await getUserFromRequest(req);
  // if (!user) {
  //   return new NextResponse("Unauthorized", { status: 401 });
  // }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return new NextResponse("ID requerido", { status: 400 });
  }

  const svc = supabaseService();
  const storagePath = `acredita/${cedulaId}.pdf`;

  const { data: fileData, error } = await svc.storage
    .from("cedulas")
    .download(storagePath);

  if (error || !fileData) {
    return new NextResponse(error?.message || "PDF no encontrado", { status: 404 });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="acredita-${cedulaId}.pdf"`,
      "Access-Control-Allow-Origin": "https://escritos.pjn.gov.ar",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://escritos.pjn.gov.ar",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
