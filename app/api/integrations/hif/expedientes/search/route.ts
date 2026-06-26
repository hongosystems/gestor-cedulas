import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { unauthorizedResponse, validateHifApiKey } from "@/lib/integrations/hif-auth";
import {
  mapJurisdiccionToFuero,
  parsePartesFromCaratula,
} from "@/lib/integrations/hif-mappers";
import {
  mergeSearchRows,
  patternCaratula,
  patternNumero,
  type PjnFavoritoSearchRow,
} from "@/lib/integrations/hif-search";

export const runtime = "nodejs";

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

  const supabase = supabaseService();
  // TODO: mejorar búsqueda multi-palabra con tokenización
  // Hoy "guaita lautaro" no encuentra "GUAITA, LAUTARO..." por la coma intermedia
  // Solución posible: tokenizar el query y hacer ILIKE AND por cada palabra
  // O usar to_tsvector + websearch_to_tsquery para full-text search profesional
  const caratulaPattern = patternCaratula(q);
  const numeroPattern = patternNumero(q);

  const [porCaratula, porNumero] = await Promise.all([
    supabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, caratula, juzgado")
      .ilike("caratula", caratulaPattern)
      .limit(15),
    supabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, caratula, juzgado")
      .ilike("numero", numeroPattern)
      .limit(15),
  ]);

  if (porCaratula.error) {
    console.error("[hif/search] caratula", porCaratula.error);
    return NextResponse.json({ error: "Error al buscar expedientes" }, { status: 500 });
  }

  if (porNumero.error) {
    console.error("[hif/search] numero", porNumero.error);
    return NextResponse.json({ error: "Error al buscar expedientes" }, { status: 500 });
  }

  const data = mergeSearchRows(
    porCaratula.data as PjnFavoritoSearchRow[] | null,
    porNumero.data as PjnFavoritoSearchRow[] | null
  );

  const results = data.map((row) => ({
    id: row.id,
    caratula: row.caratula ?? "",
    numero: row.numero,
    fuero: mapJurisdiccionToFuero(row.jurisdiccion ?? ""),
    ano: row.anio,
    partes: parsePartesFromCaratula(row.caratula ?? "").map((p) => p.nombre),
  }));

  return NextResponse.json(results);
}
