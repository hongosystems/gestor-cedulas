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
 * Extrae el número base de un expediente (sin incidente)
 * Ej: "020267/1" -> "020267", "020267" -> "020267"
 */
function extraerNumeroBase(numero: string): string {
  const match = numero.toString().trim().match(/^(\d+)/);
  return match ? match[1] : numero.toString().trim();
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
    const numeroBase = extraerNumeroBase(numero); // Para buscar expedientes relacionados
    const numeroBaseNormalizado = normalizarNumero(numeroBase);
    const anioNum = parseInt(anio.toString(), 10);
    const jurisdiccionFinal = jurisdiccion || "CIV"; // Por defecto CIV

    console.log("[search-pjn-favoritos] Parámetros normalizados:", { 
      numeroOriginal: numero, 
      numeroNormalizado, 
      numeroBase,
      numeroBaseNormalizado,
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

    // Determinar si el número ingresado es solo el base (sin incidente)
    const numeroIngresadoTieneIncidente = numero.toString().trim().includes('/');
    
    // Buscar coincidencia exacta normalizando números
    let encontrado = allData?.find(item => {
      const numeroBDNormalizado = normalizarNumero(item.numero || '');
      return numeroBDNormalizado === numeroNormalizado;
    });

    // Si el número ingresado NO tiene incidente (es solo el base), buscar expedientes relacionados
    // Esto permite detectar cuando hay principal + incidentes
    if (!numeroIngresadoTieneIncidente && allData) {
      const expedientesRelacionados = allData.filter(item => {
        const numeroBD = item.numero || '';
        const numeroBDBase = extraerNumeroBase(numeroBD);
        const numeroBDBaseNormalizado = normalizarNumero(numeroBDBase);
        return numeroBDBaseNormalizado === numeroBaseNormalizado;
      });

      // Si hay múltiples expedientes relacionados (principal + incidentes)
      if (expedientesRelacionados.length > 1) {
        console.log("[search-pjn-favoritos] Múltiples expedientes relacionados encontrados:", expedientesRelacionados.length);
        
        // Ordenar: primero el principal (sin /), luego los incidentes
        expedientesRelacionados.sort((a, b) => {
          const aTieneIncidente = (a.numero || '').includes('/');
          const bTieneIncidente = (b.numero || '').includes('/');
          if (aTieneIncidente === bTieneIncidente) return 0;
          return aTieneIncidente ? 1 : -1;
        });

        return NextResponse.json({
          encontrado: false,
          requiereSeleccion: true,
          expedientes: expedientesRelacionados.map(exp => ({
            numero: exp.numero,
            numeroCompleto: `${jurisdiccionFinal} ${exp.numero}/${exp.anio}`,
            caratula: exp.caratula || null,
            juzgado: exp.juzgado || null,
            esPrincipal: !(exp.numero || '').includes('/'),
            esIncidente: (exp.numero || '').includes('/')
          })),
          mensaje: `Se encontraron ${expedientesRelacionados.length} expediente(s) relacionados. Seleccioná el que corresponde:`
        });
      }

      // Si solo hay uno relacionado, usarlo directamente
      if (expedientesRelacionados.length === 1) {
        encontrado = expedientesRelacionados[0];
      }
    } else if (!encontrado && allData) {
      // Si el número ingresado SÍ tiene incidente pero no encontró coincidencia exacta,
      // buscar expedientes relacionados como fallback
      const expedientesRelacionados = allData.filter(item => {
        const numeroBD = item.numero || '';
        const numeroBDBase = extraerNumeroBase(numeroBD);
        const numeroBDBaseNormalizado = normalizarNumero(numeroBDBase);
        return numeroBDBaseNormalizado === numeroBaseNormalizado;
      });

      // Si solo hay uno relacionado, usarlo directamente
      if (expedientesRelacionados.length === 1) {
        encontrado = expedientesRelacionados[0];
      }
    }

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
