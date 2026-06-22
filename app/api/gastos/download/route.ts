import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth-api";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

const BUCKET = "gastos-pericia";

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const gastoId = req.nextUrl.searchParams.get("id");
    if (!gastoId) {
      return new NextResponse("Falta id", { status: 400 });
    }

    const svc = supabaseService();
    const { data: gasto, error } = await svc
      .from("gastos_anticipo")
      .select("id, pdf_storage_path, numero, anio, jurisdiccion")
      .eq("id", gastoId)
      .maybeSingle();

    if (error || !gasto?.pdf_storage_path) {
      return new NextResponse("Gasto o PDF no encontrado", { status: 404 });
    }

    const { data: fileData, error: dlError } = await svc.storage
      .from(BUCKET)
      .download(gasto.pdf_storage_path);

    if (dlError || !fileData) {
      return new NextResponse("Error descargando PDF", { status: 500 });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const label = gasto.jurisdiccion
      ? `${gasto.jurisdiccion}_${gasto.numero}_${gasto.anio}`
      : `${gasto.numero}_${gasto.anio}`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="anticipo_gastos_${label}.pdf"`,
      },
    });
  } catch (e: unknown) {
    console.error("[gastos/download]", e);
    return new NextResponse("Error interno", { status: 500 });
  }
}
