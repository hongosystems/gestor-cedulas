import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { unauthorizedResponse, validateHifApiKey } from "@/lib/integrations/hif-auth";
import {
  findUltimoMovimiento,
  mapJurisdiccionToFuero,
  parseFechaToIso,
  parsePartesFromCaratula,
  parseSecretariaFromJuzgado,
} from "@/lib/integrations/hif-mappers";

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
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[hif/detalle]", error);
    return NextResponse.json({ error: "Error al obtener expediente" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
  }

  const ultimo = findUltimoMovimiento(data.movimientos, data.id);
  const ultimaActuacionFecha =
    ultimo?.fecha ?? parseFechaToIso(data.fecha_ultima_carga) ?? null;

  return NextResponse.json({
    id: data.id,
    caratula: data.caratula ?? "",
    numero: data.numero,
    fuero: mapJurisdiccionToFuero(data.jurisdiccion),
    ano: data.anio,
    juzgado: data.juzgado ?? null,
    secretaria: parseSecretariaFromJuzgado(data.juzgado),
    partes: parsePartesFromCaratula(data.caratula ?? ""),
    estado: "En trámite",
    ultimaActuacion: ultimo?.tipo ?? null,
    ultimaActuacionFecha,
  });
}
