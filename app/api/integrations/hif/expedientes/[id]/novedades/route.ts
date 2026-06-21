import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { unauthorizedResponse, validateHifApiKey } from "@/lib/integrations/hif-auth";
import { parseAllMovimientos } from "@/lib/integrations/hif-mappers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  if (!validateHifApiKey(req)) {
    return unauthorizedResponse();
  }

  const { id } = await context.params;
  const desdeParam = req.nextUrl.searchParams.get("desde")?.trim();
  let desdeIso: string | null = null;

  if (desdeParam) {
    const parsed = Date.parse(desdeParam);
    if (Number.isNaN(parsed)) {
      return NextResponse.json(
        { error: "El parámetro desde debe ser una fecha ISO 8601 válida" },
        { status: 400 }
      );
    }
    desdeIso = new Date(parsed).toISOString();
  }

  const supabase = supabaseService();

  const { data, error } = await supabase
    .from("pjn_favoritos")
    .select("id, movimientos")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[hif/novedades]", error);
    return NextResponse.json({ error: "Error al obtener novedades" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
  }

  let movimientos = parseAllMovimientos(data.movimientos, data.id);

  if (desdeIso) {
    movimientos = movimientos.filter((mov) => mov.fecha >= desdeIso!);
  }

  const novedades = movimientos.map(({ id: movId, expedienteId, fecha, tipo, detalle, texto, raw }) => ({
    id: movId,
    expedienteId,
    fecha,
    tipo,
    titulo: tipo,
    detalle,
    texto,
    raw,
  }));

  return NextResponse.json({ novedades });
}
