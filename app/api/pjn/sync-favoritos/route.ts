import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Función para parsear expediente (ej: "CIV 106590/2024" -> {jurisdiccion: "CIV", numero: "106590", anio: 2024})
function parseExpediente(expText: string | null | undefined) {
  if (!expText) return null;
  
  const match = expText.match(/^([A-Z]+)\s+(\d+)\/(\d+)/);
  if (!match) return null;
  
  const [, jurisdiccion, numero, anioStr] = match;
  const anio = parseInt(anioStr, 10);
  
  if (!jurisdiccion || !numero || isNaN(anio)) return null;
  
  return { jurisdiccion, numero, anio };
}

// Normalizar juzgado para guardar SIN "- SECRETARIA N° X"
function normalizeJuzgado(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const j = String(raw).trim().replace(/\s+/g, ' ').toUpperCase();
  // Caso principal: JUZGADO CIVIL <NUM>
  const mCivil = /^JUZGADO\s+CIVIL\s+(\d+)\b/i.exec(j);
  if (mCivil) {
    return `JUZGADO CIVIL ${mCivil[1]}`;
  }
  // Fallback: cortar sufijo " - SECRETARIA N° X" si está al final
  const stripped = j.replace(/\s*-\s*SECRETAR[ÍI]A\s*N[°º]?\s*\d+\s*.*$/i, '').trim();
  return stripped || null;
}

// Función para convertir fecha a DD/MM/YYYY
function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    let date: Date;
    if (typeof dateStr === 'string' && dateStr.includes('/')) {
      // Formato DD/MM/YYYY
      const parts = dateStr.trim().split('/');
      if (parts.length === 3) {
        const [dia, mes, anio] = parts.map(p => parseInt(p, 10));
        date = new Date(anio, mes - 1, dia);
      } else {
        date = new Date(dateStr);
      }
    } else {
      date = new Date(dateStr);
    }
    
    if (isNaN(date.getTime())) return null;
    
    const dia = String(date.getDate()).padStart(2, '0');
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const anio = date.getFullYear();
    return `${dia}/${mes}/${anio}`;
  } catch {
    return null;
  }
}

// Función para extraer observaciones de movimientos
function extractObservaciones(movimientos: unknown): string | null {
  if (!movimientos) return null;
  
  try {
    if (Array.isArray(movimientos) && movimientos.length > 0) {
      let tipoActuacion: string | null = null;
      let detalle: string | null = null;
      
      for (let i = 0; i < movimientos.length; i++) {
        const mov = movimientos[i];
        
        if (typeof mov === 'object' && mov !== null) {
          if (mov.cols && Array.isArray(mov.cols)) {
            for (const col of mov.cols) {
              const colStr = String(col).trim();
              
              if (!tipoActuacion) {
                const matchTipo = colStr.match(/^Tipo\s+actuacion:\s*(.+)$/i);
                if (matchTipo && matchTipo[1].trim() !== "") {
                  tipoActuacion = `Tipo actuacion: ${matchTipo[1].trim()}`;
                }
              }
              
              if (!detalle) {
                const matchDetalle = colStr.match(/^Detalle:\s*(.+)$/i);
                if (matchDetalle && matchDetalle[1].trim() !== "") {
                  detalle = `Detalle: ${matchDetalle[1].trim()}`;
                }
              }
            }
            
            if (tipoActuacion && detalle) {
              break;
            }
          }
        }
      }
      
      if (tipoActuacion && detalle) {
        return `${tipoActuacion}\n${detalle}`;
      }
    }
  } catch (err) {
    console.warn(`⚠️  Error al extraer observaciones:`, err);
  }
  
  return null;
}

/**
 * Función principal de sincronización (compartida entre GET y POST)
 */
async function performSync(req: NextRequest) {
  try {
    // Verificar autenticación opcional (secret para cron jobs)
    const syncSecret = process.env.PJN_SYNC_SECRET;
    if (syncSecret) {
      const authHeader = req.headers.get("authorization");
      const providedSecret = authHeader?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");
      
      if (providedSecret !== syncSecret) {
        return NextResponse.json(
          { error: "No autorizado. Se requiere secret válido." },
          { status: 401 }
        );
      }
    }

    // Verificar variables de entorno
    const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL || mainSupabaseUrl;
    const pjnSupabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!mainSupabaseUrl || !mainSupabaseServiceKey) {
      return NextResponse.json(
        { error: "Faltan variables de entorno de la base principal" },
        { status: 500 }
      );
    }

    if (!pjnSupabaseUrl || !pjnSupabaseAnonKey) {
      return NextResponse.json(
        { error: "Faltan variables de entorno de pjn-scraper" },
        { status: 500 }
      );
    }

    const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);
    const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);

    console.log("[sync-favoritos] Iniciando sincronización...");

    // 1. Leer todos los casos de pjn-scraper (incluyendo columna removido)
    console.log("[sync-favoritos] Leyendo casos de pjn-scraper...");
    const { data: casesData, error: casesErr } = await pjnSupabase
      .from("cases")
      .select("key, expediente, caratula, dependencia, ult_act, situacion, movimientos, removido")
      .order("ult_act", { ascending: false });

    if (casesErr) {
      console.error("[sync-favoritos] Error al leer cases:", casesErr);
      return NextResponse.json(
        { error: "Error al leer casos de pjn-scraper", details: casesErr.message },
        { status: 500 }
      );
    }

    if (!casesData || casesData.length === 0) {
      console.log("[sync-favoritos] No hay casos en pjn-scraper");
      return NextResponse.json({
        success: true,
        message: "No hay casos para sincronizar",
        inserted: 0,
        updated: 0,
        deleted: 0
      });
    }

    console.log(`[sync-favoritos] Encontrados ${casesData.length} casos en pjn-scraper`);

    // 2. Convertir casos a formato pjn_favoritos
    const favoritosToUpsert: Array<{
      jurisdiccion: string;
      numero: string;
      anio: number;
      caratula: string | null;
      juzgado: string | null;
      fecha_ultima_carga: string | null;
      observaciones: string | null;
      source_url: string | null;
      updated_at: string;
    }> = [];

    const casesKeys = new Set<string>(); // Para trackear qué casos existen (NO removidos)
    const removedKeys = new Set<string>(); // Para trackear casos removidos

    for (const c of casesData) {
      const expText = c.key || c.expediente;
      const parsed = parseExpediente(expText);
      
      if (!parsed) {
        continue;
      }

      // Normalizar número para la key (agregar ceros a la izquierda para consistencia)
      const numeroNormalizado = parsed.numero.padStart(6, '0');
      const key = `${parsed.jurisdiccion}|${numeroNormalizado}|${parsed.anio}`;
      // También crear key sin ceros a la izquierda para compatibilidad
      const keySinCeros = `${parsed.jurisdiccion}|${parsed.numero}|${parsed.anio}`;
      
      // Si el caso está marcado como removido, agregarlo a removedKeys y NO sincronizarlo
      if (c.removido === true) {
        removedKeys.add(key);
        removedKeys.add(keySinCeros); // Agregar ambas variaciones
        continue; // No agregar a favoritosToUpsert ni a casesKeys
      }
      
      // Solo agregar a casesKeys si NO está removido (agregar ambas variaciones)
      casesKeys.add(key);
      casesKeys.add(keySinCeros);

      // Manejar fecha
      let fechaUltimaCarga: string | null = null;
      let updatedAt = new Date().toISOString();

      if (c.ult_act) {
        try {
          let date: Date;
          if (typeof c.ult_act === 'string' && c.ult_act.includes('/')) {
            const parts = c.ult_act.trim().split('/');
            if (parts.length === 3) {
              const [dia, mes, anio] = parts.map(p => parseInt(p, 10));
              date = new Date(anio, mes - 1, dia);
            } else {
              date = new Date(c.ult_act);
            }
          } else {
            date = new Date(c.ult_act);
          }
          
          if (!isNaN(date.getTime())) {
            fechaUltimaCarga = formatDate(date.toISOString());
            updatedAt = date.toISOString();
          }
        } catch {
          // Fecha inválida, usar valores por defecto
        }
      }

      const observaciones = extractObservaciones(c.movimientos);

      favoritosToUpsert.push({
        jurisdiccion: parsed.jurisdiccion,
        numero: parsed.numero,
        anio: parsed.anio,
        caratula: c.caratula || null,
        juzgado: normalizeJuzgado(c.dependencia),
        fecha_ultima_carga: fechaUltimaCarga,
        observaciones: observaciones,
        source_url: null,
        updated_at: updatedAt,
      });
    }

    console.log(`[sync-favoritos] ${favoritosToUpsert.length} casos válidos para sincronizar`);

    // 3. Upsert en pjn_favoritos (insertar o actualizar)
    let updated = 0;
    const batchSize = 100;

    for (let i = 0; i < favoritosToUpsert.length; i += batchSize) {
      const batch = favoritosToUpsert.slice(i, i + batchSize);
      
      // Eliminar duplicados dentro del lote
      const seen = new Set<string>();
      const uniqueBatch = batch.filter(item => {
        const key = `${item.jurisdiccion}|${item.numero}|${item.anio}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });

      if (uniqueBatch.length === 0) {
        continue;
      }

      const { data, error } = await mainSupabase
        .from("pjn_favoritos")
        .upsert(uniqueBatch, { 
          onConflict: "jurisdiccion,numero,anio",
          ignoreDuplicates: false
        })
        .select("id");

      if (error) {
        console.error(`[sync-favoritos] Error al hacer upsert del lote ${Math.floor(i / batchSize) + 1}:`, error);
        // Continuar con el siguiente lote
        continue;
      }

      // No podemos distinguir entre insert y update con upsert, así que contamos todos como actualizados
      updated += data?.length || 0;
    }

    console.log(`[sync-favoritos] ${updated} casos insertados/actualizados`);

    // 4. Eliminar de pjn_favoritos los expedientes removidos o que ya no están en cases
    console.log("[sync-favoritos] Eliminando expedientes removidos de favoritos...");
    
    if (removedKeys.size > 0) {
      console.log(`[sync-favoritos] ${removedKeys.size} casos marcados como removidos en pjn-scraper`);
    }
    
    // Obtener todos los favoritos actuales
    const { data: currentFavoritos, error: favoritosErr } = await mainSupabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio");

    if (favoritosErr) {
      console.error("[sync-favoritos] Error al leer favoritos actuales:", favoritosErr);
      return NextResponse.json(
        { 
          success: true,
          message: "Sincronización parcial completada",
          inserted: 0,
          updated: updated,
          deleted: 0,
          warning: "No se pudieron eliminar expedientes removidos"
        }
      );
    }

    // Encontrar favoritos que deben eliminarse:
    // 1. Casos marcados como removidos en pjn-scraper
    // 2. Casos que ya no están en cases (fueron eliminados completamente)
    const favoritosToDelete: string[] = [];
    
    if (currentFavoritos) {
      for (const fav of currentFavoritos) {
        // Normalizar número para comparar (agregar ceros a la izquierda si es necesario)
        const numeroNormalizado = String(fav.numero).padStart(6, '0');
        const key = `${fav.jurisdiccion}|${numeroNormalizado}|${fav.anio}`;
        const keyOriginal = `${fav.jurisdiccion}|${fav.numero}|${fav.anio}`;
        // También verificar variaciones del número (sin ceros a la izquierda)
        const numeroSinCeros = String(fav.numero).replace(/^0+/, '');
        const keySinCeros = `${fav.jurisdiccion}|${numeroSinCeros}|${fav.anio}`;
        
        // Eliminar si está marcado como removido O si no está en casesKeys (no existe en cases)
        // Intentar con todas las variaciones de keys para mayor compatibilidad
        const shouldDelete = 
          removedKeys.has(key) || 
          removedKeys.has(keyOriginal) || 
          removedKeys.has(keySinCeros) ||
          (!casesKeys.has(key) && !casesKeys.has(keyOriginal) && !casesKeys.has(keySinCeros));
        
        if (shouldDelete) {
          favoritosToDelete.push(fav.id);
        }
      }
    }

    let deleted = 0;
    if (favoritosToDelete.length > 0) {
      console.log(`[sync-favoritos] Eliminando ${favoritosToDelete.length} expedientes (removidos o no existentes)...`);
      
      // Eliminar en lotes
      for (let i = 0; i < favoritosToDelete.length; i += batchSize) {
        const batch = favoritosToDelete.slice(i, i + batchSize);
        const { error: deleteErr } = await mainSupabase
          .from("pjn_favoritos")
          .delete()
          .in("id", batch);

        if (deleteErr) {
          console.error(`[sync-favoritos] Error al eliminar lote:`, deleteErr);
        } else {
          deleted += batch.length;
        }
      }
    } else {
      console.log("[sync-favoritos] No hay expedientes para eliminar");
    }

    console.log(`[sync-favoritos] ${deleted} expedientes eliminados`);

    // 5. Actualizar metadata de última sincronización
    try {
      const fixedId = '00000000-0000-0000-0000-000000000001';
      const syncTimestamp = new Date().toISOString();
      console.log("[sync-favoritos] Intentando actualizar metadata con timestamp:", syncTimestamp);
      
      const { data: metadataData, error: metadataErr } = await mainSupabase
        .from("pjn_sync_metadata")
        .upsert(
          { id: fixedId, last_sync_at: syncTimestamp },
          { onConflict: "id" }
        )
        .select("last_sync_at");

      if (metadataErr) {
        console.error("[sync-favoritos] ❌ Error al actualizar metadata:", metadataErr);
        const errDetails = metadataErr as { code?: string; details?: string; message?: string };
        console.error("[sync-favoritos] Error code:", errDetails.code);
        console.error("[sync-favoritos] Error message:", metadataErr.message);
        console.error("[sync-favoritos] Error details:", errDetails.details);
        
        // Si la tabla no existe, sugerir ejecutar la migración
        if (metadataErr.code === 'PGRST116' || metadataErr.message?.includes('does not exist')) {
          console.error("[sync-favoritos] ⚠️  La tabla pjn_sync_metadata no existe. Ejecuta la migración SQL: migrations/create_pjn_sync_metadata_table.sql");
        }
      } else {
        console.log("[sync-favoritos] ✅ Metadata de sincronización actualizada exitosamente");
        console.log("[sync-favoritos] Datos guardados:", metadataData);
      }
    } catch (metadataError) {
      console.error("[sync-favoritos] ❌ Error inesperado al actualizar metadata:", metadataError);
      const err = metadataError as { stack?: string };
      console.error("[sync-favoritos] Error stack:", err?.stack);
    }

    return NextResponse.json({
      success: true,
      message: "Sincronización completada",
      inserted: 0, // No podemos distinguir entre insert y update
      updated: updated,
      deleted: deleted,
      removed: removedKeys.size,
      totalCases: casesData.length,
      totalFavoritos: favoritosToUpsert.length
    });

  } catch (error) {
    console.error("[sync-favoritos] Error inesperado:", error);
    const err = error as { message?: string };
    return NextResponse.json(
      { error: "Error interno del servidor", details: err?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}

/**
 * Endpoint GET para sincronización (usado por Vercel Cron)
 * Vercel cron jobs hacen GET requests por defecto
 */
export async function GET(req: NextRequest) {
  console.log("[sync-favoritos] GET request recibido (probablemente desde Vercel Cron)");
  return performSync(req);
}

/**
 * Endpoint POST para sincronización (usado para llamadas manuales)
 */
export async function POST(req: NextRequest) {
  console.log("[sync-favoritos] POST request recibido");
  return performSync(req);
}
