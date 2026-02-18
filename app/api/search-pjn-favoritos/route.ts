import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Faltan variables de entorno de Supabase");
  }
  
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Normaliza un número de expediente eliminando ceros a la izquierda
 */
function normalizarNumero(numero: string | number): string {
  return numero.toString().trim().replace(/^0+/, '') || '0';
}

/**
 * Busca un expediente en pjn_favoritos_v (vista) por jurisdicción, número y año
 * Retorna caratula y juzgado si se encuentra
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { numero, anio, jurisdiccion } = body;

    console.log("[search-pjn-favoritos] Búsqueda recibida:", { numero, anio, jurisdiccion });

    if (!numero || !anio) {
      return NextResponse.json(
        { error: "Faltan número o año del expediente." },
        { status: 400 }
      );
    }

    const numeroNormalizado = normalizarNumero(numero);
    const anioNum = parseInt(anio.toString(), 10);
    const jurisdiccionFinal = jurisdiccion || "CIV"; // Por defecto CIV

    console.log("[search-pjn-favoritos] Parámetros normalizados:", { 
      numeroOriginal: numero, 
      numeroNormalizado, 
      anio: anioNum,
      jurisdiccion: jurisdiccionFinal
    });

    // Usar cliente admin para evitar problemas de RLS
    const supabase = getSupabaseAdmin();

    // ESTRATEGIA 1: Buscar primero por jurisdicción, número y año (búsqueda exacta)
    let { data: allData, error } = await supabase
      .from("pjn_favoritos_v")
      .select("caratula, juzgado, jurisdiccion, numero, anio")
      .eq("jurisdiccion", jurisdiccionFinal)
      .eq("anio", anioNum);

    if (error) {
      console.error("[search-pjn-favoritos] Error en consulta (por año):", error);
      return NextResponse.json(
        { error: "Error al buscar en la base de datos." },
        { status: 500 }
      );
    }

    console.log("[search-pjn-favoritos] Registros encontrados por jurisdicción y año:", allData?.length || 0);

    // Buscar coincidencia normalizando números
    let encontrado = allData?.find(item => {
      const numeroBDNormalizado = normalizarNumero(item.numero || '');
      return numeroBDNormalizado === numeroNormalizado;
    });

    // ESTRATEGIA 2: Si no encontró con el año exacto, buscar solo por jurisdicción y número
    // (por si el año en la BD es diferente)
    if (!encontrado) {
      console.log("[search-pjn-favoritos] No se encontró con año exacto, buscando solo por jurisdicción y número...");
      
      const { data: allDataSinAnio, error: errorSinAnio } = await supabase
        .from("pjn_favoritos_v")
        .select("caratula, juzgado, jurisdiccion, numero, anio")
        .eq("jurisdiccion", jurisdiccionFinal);

      if (!errorSinAnio && allDataSinAnio) {
        console.log("[search-pjn-favoritos] Registros encontrados por jurisdicción (sin año):", allDataSinAnio.length);
        
        encontrado = allDataSinAnio.find(item => {
          const numeroBDNormalizado = normalizarNumero(item.numero || '');
          const coincide = numeroBDNormalizado === numeroNormalizado;
          
          if (coincide) {
            console.log("[search-pjn-favoritos] Coincidencia encontrada (año diferente):", {
              numeroBD: item.numero,
              numeroBDNormalizado,
              numeroBuscado: numero,
              numeroBuscadoNormalizado: numeroNormalizado,
              jurisdiccion: item.jurisdiccion,
              anioBD: item.anio,
              anioBuscado: anioNum
            });
          }
          
          return coincide;
        });

        // Si encontró pero con año diferente, usar ese registro
        if (encontrado) {
          console.log("[search-pjn-favoritos] ⚠️ Expediente encontrado pero con año diferente:", {
            añoEnBD: encontrado.anio,
            añoBuscado: anioNum
          });
        }
      }
    }

    if (!encontrado) {
      console.log("[search-pjn-favoritos] No se encontró coincidencia. Últimos registros verificados:", 
        (allData || []).slice(0, 5).map(item => ({ 
          jurisdiccion: item.jurisdiccion,
          numero: item.numero, 
          numeroNormalizado: normalizarNumero(item.numero || ''),
          anio: item.anio
        }))
      );
      return NextResponse.json({ 
        encontrado: false,
        mensaje: "El EXPEDIENTE no figura en la base de datos."
      });
    }

    console.log("[search-pjn-favoritos] Expediente encontrado:", {
      numero: encontrado.numero,
      anio: encontrado.anio,
      jurisdiccion: encontrado.jurisdiccion,
      tieneCaratula: !!encontrado.caratula,
      tieneJuzgado: !!encontrado.juzgado
    });

    return NextResponse.json({
      encontrado: true,
      caratula: encontrado.caratula || null,
      juzgado: encontrado.juzgado || null,
      jurisdiccion: encontrado.jurisdiccion || null,
      numero: encontrado.numero || null,
      anio: encontrado.anio || null
    });
  } catch (e: any) {
    console.error("[search-pjn-favoritos] Error general:", e);
    return NextResponse.json(
      { error: e?.message || "Error procesando búsqueda." },
      { status: 500 }
    );
  }
}
