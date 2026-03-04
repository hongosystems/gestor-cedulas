import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * Endpoint para obtener movimientos de un expediente desde cases (pjn-scraper)
 * Usado como fallback cuando no hay movimientos en pjn_favoritos
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jurisdiccion, numero, anio } = body;

    if (!jurisdiccion || !numero || !anio) {
      return NextResponse.json(
        { error: "Faltan parámetros: jurisdiccion, numero, anio" },
        { status: 400 }
      );
    }

    // Cliente para base de datos pjn-scraper
    const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
    const pjnSupabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;

    if (!pjnSupabaseUrl || !pjnSupabaseAnonKey) {
      return NextResponse.json(
        { error: "Variables de entorno de pjn-scraper no configuradas" },
        { status: 500 }
      );
    }

    const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);

    // Construir key del expediente (formato: "CIV 027462/2023")
    const numeroNormalizado = String(numero).padStart(6, '0');
    const key = `${jurisdiccion} ${numeroNormalizado}/${anio}`;
    const keySinCeros = `${jurisdiccion} ${numero}/${anio}`;

    // Buscar en cases
    const { data: caseData, error: caseError } = await pjnSupabase
      .from("cases")
      .select("key, movimientos")
      .or(`key.eq.${key},key.eq.${keySinCeros}`)
      .limit(1);

    if (caseError) {
      console.error("[get-movimientos] Error al buscar en cases:", caseError);
      return NextResponse.json(
        { error: "Error al buscar movimientos", details: caseError.message },
        { status: 500 }
      );
    }

    if (!caseData || caseData.length === 0 || !caseData[0].movimientos) {
      return NextResponse.json({
        encontrado: false,
        movimientos: null
      });
    }

    return NextResponse.json({
      encontrado: true,
      movimientos: caseData[0].movimientos
    });

  } catch (error) {
    console.error("[get-movimientos] Error inesperado:", error);
    const err = error as { message?: string };
    return NextResponse.json(
      { error: "Error interno del servidor", details: err?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
