import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { unauthorizedResponse, validateHifApiKey } from "@/lib/integrations/hif-auth";
import {
  mapJurisdiccionToFuero,
  parsePartesFromCaratula,
} from "@/lib/integrations/hif-mappers";

export const runtime = "nodejs";

function escapeIlikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

export async function GET(req: NextRequest) {
  if (!validateHifApiKey(req)) {
    return unauthorizedResponse();
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) {
    return NextResponse.json(
      { error: "El parámetro q debe tener al menos 3 caracteres" },
      { status: 400 }
    );
  }

  const pattern = `%${escapeIlikePattern(q)}%`;
  const supabase = supabaseService();

  const { data, error } = await supabase
    .from("pjn_favoritos")
    .select("id, jurisdiccion, numero, anio, caratula, juzgado")
    .or(`caratula.ilike.${pattern},numero.ilike.${pattern}`)
    .limit(20);

  if (error) {
    console.error("[hif/search]", error);
    return NextResponse.json({ error: "Error al buscar expedientes" }, { status: 500 });
  }

  const results = (data ?? []).map((row) => ({
    id: row.id,
    caratula: row.caratula ?? "",
    numero: row.numero,
    fuero: mapJurisdiccionToFuero(row.jurisdiccion),
    ano: row.anio,
    partes: parsePartesFromCaratula(row.caratula ?? "").map((p) => p.nombre),
  }));

  return NextResponse.json(results);
}
