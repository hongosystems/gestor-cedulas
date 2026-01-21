import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getPjnScraperSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Variables de entorno de pjn-scraper Supabase no configuradas");
  }
  
  return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Busca un expediente en la base de datos pjn-scraper
 * Parámetros esperados:
 * - jurisdiccion: ej. "CIV"
 * - numero: ej. "068809"
 * - año: ej. "2017"
 * 
 * Retorna los datos del expediente si se encuentra:
 * - caratula
 * - dependencia (juzgado)
 * - ult_act (fecha última modificación)
 * - movimientos (jsonb - se extrae el más reciente)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jurisdiccion, numero, año } = body;

    if (!jurisdiccion || !numero || !año) {
      return NextResponse.json(
        { error: "Faltan parámetros: jurisdiccion, numero, año" },
        { status: 400 }
      );
    }

    // Construir el formato del expediente: "CIV 068809/2017"
    const expedienteBuscar = `${jurisdiccion} ${numero.padStart(6, "0")}/${año}`;
    console.log("[search-expediente-pjn] Buscando expediente:", expedienteBuscar);

    const supabase = getPjnScraperSupabase();

    // Nombre de la tabla: puede configurarse mediante variable de entorno o usar "cases" por defecto
    const tableName = process.env.PJN_SCRAPER_TABLE_NAME || "cases";

    // Buscar en la tabla "cases" del proyecto pjn-scraper
    // Primero buscar por "key" (campo principal según la estructura de la tabla)
    // También incluir ult_act y movimientos si existen directamente en cases
    let { data: caseData, error: caseError } = await supabase
      .from(tableName)
      .select("caratula, dependencia, situacion, key, expediente, ult_act, movimientos")
      .eq("key", expedienteBuscar)
      .maybeSingle();

    console.log("[search-expediente-pjn] Búsqueda por key:", {
      expedienteBuscar,
      encontrado: !!caseData,
      error: caseError?.message,
    });

    // Si no encuentra por key, intentar buscar por expediente
    if (!caseData && !caseError) {
      const { data: caseDataByExpediente, error: caseErrorByExpediente } = await supabase
        .from(tableName)
        .select("caratula, dependencia, situacion, key, expediente, ult_act, movimientos")
        .eq("expediente", expedienteBuscar)
        .maybeSingle();

      console.log("[search-expediente-pjn] Búsqueda por expediente:", {
        expedienteBuscar,
        encontrado: !!caseDataByExpediente,
        error: caseErrorByExpediente?.message,
      });

      if (caseDataByExpediente) {
        caseData = caseDataByExpediente;
      }
      if (caseErrorByExpediente && !caseError) {
        caseError = caseErrorByExpediente;
      }
    }

    // Si aún no encuentra, intentar buscar con LIKE para manejar posibles variaciones de formato
    if (!caseData && !caseError) {
      const { data: caseDataLike, error: caseErrorLike } = await supabase
        .from(tableName)
        .select("caratula, dependencia, situacion, key, expediente, ult_act, movimientos")
        .ilike("expediente", `%${expedienteBuscar.replace(/\s+/g, "%")}%`)
        .limit(1)
        .maybeSingle();

      console.log("[search-expediente-pjn] Búsqueda con LIKE:", {
        expedienteBuscar,
        encontrado: !!caseDataLike,
        error: caseErrorLike?.message,
      });

      if (caseDataLike) {
        caseData = caseDataLike;
        console.log("[search-expediente-pjn] Encontrado con LIKE, expediente en DB:", caseDataLike.expediente);
      }
    }

    if (caseError) {
      console.error("[search-expediente-pjn] Error al buscar en cases:", caseError);
      
      // Si el error es que la tabla no existe, dar un mensaje más claro
      if (caseError.message?.includes("Could not find the table") || caseError.message?.includes("does not exist")) {
        return NextResponse.json(
          { 
            error: `La tabla "${tableName}" no existe en la base de datos pjn-scraper`,
            details: `Por favor verifica que la tabla existe o configura el nombre correcto mediante la variable de entorno PJN_SCRAPER_TABLE_NAME. Error: ${caseError.message}`,
            tableName,
          },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { error: "Error al buscar en la base de datos", details: caseError.message },
        { status: 500 }
      );
    }

    if (!caseData) {
      console.log("[search-expediente-pjn] No se encontró expediente. Intentando listar algunos expedientes para debug...");
      // Intentar obtener algunos expedientes para ver el formato real
      try {
        const { data: sampleData } = await supabase
          .from(tableName)
          .select("expediente, key")
          .limit(5);
        console.log("[search-expediente-pjn] Ejemplos de expedientes en la DB:", sampleData);
      } catch (e) {
        console.log("[search-expediente-pjn] No se pudo obtener ejemplos:", e);
      }
      return NextResponse.json({ found: false });
    }

    // Buscar información adicional en case_snapshots si existe (movimientos)
    // Primero verificar si caseData tiene ult_act directamente
    let ultAct = caseData?.ult_act || null;
    let movimientos = null;
    
    // Si caseData tiene ult_act directamente, ya lo tenemos
    if (ultAct) {
      console.log("[search-expediente-pjn] ult_act encontrado directamente en cases:", ultAct);
    }

    try {
      // Intentar buscar movimientos en case_snapshots (sin buscar ult_act ya que no existe)
      let snapshotData = null;
      let snapshotError = null;

      // Si tiene key, intentar buscar por key
      if (caseData.key) {
        const { data: keyData, error: keyError } = await supabase
          .from("case_snapshots")
          .select("movimientos, key, expediente")
          .eq("key", caseData.key)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        console.log("[search-expediente-pjn] Búsqueda en case_snapshots por key:", {
          key: caseData.key,
          encontrado: !!keyData,
          error: keyError?.message,
          tieneMovimientos: !!keyData?.movimientos,
        });
        
        if (!keyError && keyData) {
          snapshotData = keyData;
        } else {
          snapshotError = keyError;
        }
      }

      // Si no encontró por key, intentar por expediente
      if (!snapshotData) {
        const { data: expData, error: expError } = await supabase
          .from("case_snapshots")
          .select("movimientos, key, expediente")
          .eq("expediente", expedienteBuscar)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        console.log("[search-expediente-pjn] Búsqueda en case_snapshots por expediente:", {
          expediente: expedienteBuscar,
          encontrado: !!expData,
          error: expError?.message,
          tieneMovimientos: !!expData?.movimientos,
        });
        
        if (!expError && expData) {
          snapshotData = expData;
        } else {
          snapshotError = expError;
        }
      }

      if (snapshotData) {
        movimientos = snapshotData.movimientos || null;
        console.log("[search-expediente-pjn] Datos obtenidos de case_snapshots:", {
          movimientosTipo: typeof movimientos,
          esArray: Array.isArray(movimientos),
          movimientosLength: Array.isArray(movimientos) ? movimientos.length : "N/A",
          movimientosPreview: movimientos ? JSON.stringify(movimientos).substring(0, 200) : null,
        });
      } else if (snapshotError) {
        // Solo loguear si el error no es "column does not exist" (que es esperado)
        if (!snapshotError.message?.includes("does not exist")) {
          console.log("[search-expediente-pjn] Error al buscar en case_snapshots:", snapshotError);
        }
      }
    } catch (err: any) {
      // Si la tabla case_snapshots no existe o hay error, continuar sin esos datos
      console.log("[search-expediente-pjn] No se pudo obtener datos de case_snapshots (opcional):", err?.message);
    }
    
    // También verificar si movimientos está directamente en la tabla cases
    if (!movimientos && caseData.movimientos) {
      movimientos = caseData.movimientos;
      console.log("[search-expediente-pjn] Movimientos encontrados directamente en cases");
    }

    // Usar los datos encontrados
    // Si ultAct no se encontró en snapshots pero sí en cases, usarlo
    const ultActFinal = ultAct || caseData.ult_act || null;
    
    const data = {
      caratula: caseData.caratula || null,
      dependencia: caseData.dependencia || null,
      ult_act: ultActFinal,
      movimientos: movimientos,
    };

    console.log("[search-expediente-pjn] Datos finales preparados:", {
      tieneCaratula: !!data.caratula,
      tieneDependencia: !!data.dependencia,
      tieneUltAct: !!data.ult_act,
      ultActValue: data.ult_act,
      tieneMovimientos: !!data.movimientos,
      movimientosTipo: typeof data.movimientos,
      movimientosEsArray: Array.isArray(data.movimientos),
    });

    // Extraer el último movimiento con Tipo actuacion y Detalle con información (después de los dos puntos)
    let observacionesTexto = "";
    if (data.movimientos) {
      try {
        const movimientos = data.movimientos;
        
        console.log("[search-expediente-pjn] Procesando movimientos para encontrar el último con información:", {
          esArray: Array.isArray(movimientos),
          length: Array.isArray(movimientos) ? movimientos.length : "N/A",
          tipo: typeof movimientos,
        });
        
        // Si es un array de objetos
        if (Array.isArray(movimientos) && movimientos.length > 0) {
          let tipoActuacion = null;
          let detalle = null;
          
          // Buscar desde el inicio hacia el final para encontrar el primero (más actual) con información completa
          for (let i = 0; i < movimientos.length; i++) {
            const mov = movimientos[i];
            
            if (typeof mov === 'object' && mov !== null) {
              // Si tiene cols (array de strings)
              if (mov.cols && Array.isArray(mov.cols)) {
                // Buscar Tipo actuacion y Detalle en este movimiento
                for (const col of mov.cols) {
                  const colStr = String(col).trim();
                  
                  // Buscar Tipo actuacion (verificar que tenga contenido después de :)
                  if (!tipoActuacion) {
                    const matchTipo = colStr.match(/^Tipo\s+actuacion:\s*(.+)$/i);
                    if (matchTipo && matchTipo[1].trim() !== "") {
                      tipoActuacion = `Tipo actuacion: ${matchTipo[1].trim()}`;
                    }
                  }
                  
                  // Buscar Detalle (verificar que tenga contenido después de :)
                  if (!detalle) {
                    const matchDetalle = colStr.match(/^Detalle:\s*(.+)$/i);
                    if (matchDetalle && matchDetalle[1].trim() !== "") {
                      detalle = `Detalle: ${matchDetalle[1].trim()}`;
                    }
                  }
                }
                
                // Si encontramos ambos con información, ya tenemos lo que necesitamos
                if (tipoActuacion && detalle) {
                  console.log("[search-expediente-pjn] Movimiento encontrado en índice:", i, {
                    tipoActuacion,
                    detalle,
                  });
                  break;
                }
              }
            }
          }
          
          // Si encontramos ambos, formatear el resultado
          if (tipoActuacion && detalle) {
            observacionesTexto = `${tipoActuacion}\n${detalle}`;
          } else {
            console.log("[search-expediente-pjn] No se encontró un movimiento con ambos campos con información:", {
              tieneTipoActuacion: !!tipoActuacion,
              tieneDetalle: !!detalle,
            });
          }
        }
        
        console.log("[search-expediente-pjn] Observaciones extraídas:", {
          observacionesTexto,
          longitud: observacionesTexto.length,
        });
      } catch (err: any) {
        console.error("[search-expediente-pjn] Error al formatear movimientos:", err);
        observacionesTexto = "";
      }
    }

    const responseData = {
      found: true,
      caratula: data.caratula || null,
      juzgado: data.dependencia || null,
      fechaUltimaModificacion: data.ult_act || null,
      observaciones: observacionesTexto || null,
    };

    console.log("[search-expediente-pjn] Retornando datos:", {
      found: responseData.found,
      caratula: responseData.caratula ? `${responseData.caratula.substring(0, 50)}...` : null,
      juzgado: responseData.juzgado,
      fechaUltimaModificacion: responseData.fechaUltimaModificacion,
      observacionesLength: responseData.observaciones ? responseData.observaciones.length : 0,
    });

    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error("[search-expediente-pjn] Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor", details: error.message },
      { status: 500 }
    );
  }
}
