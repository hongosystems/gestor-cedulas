import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { unauthorizedResponse, validateHifApiKey } from "@/lib/integrations/hif-auth";
import { parseAllMovimientos } from "@/lib/integrations/hif-mappers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext) {
  if (!validateHifApiKey(req)) {
    return unauthorizedResponse();
  }

  const { id } = await context.params;
  const supabase = supabaseService();

  const { data, error } = await supabase
    .from("pjn_favoritos")
    .select("id, movimientos")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[hif/movimientos]", error);
    return NextResponse.json({ error: "Error al obtener movimientos" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
  }

  const movimientos = parseAllMovimientos(data.movimientos, data.id).map(
    ({ id: movId, expedienteId, fecha, tipo, detalle, texto }) => ({
      id: movId,
      expedienteId,
      fecha,
      tipo,
      detalle,
      texto,
    })
  );

  return NextResponse.json({ movimientos });
}
