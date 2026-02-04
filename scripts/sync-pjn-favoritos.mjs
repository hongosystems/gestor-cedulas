/**
 * Script para ejecutar la sincronización de cases a pjn_favoritos
 * 
 * Uso:
 *   node scripts/sync-pjn-favoritos.mjs
 * 
 * Requiere variables de entorno (cargadas desde .env.local):
 *   - NEXT_PUBLIC_SUPABASE_URL (base principal)
 *   - SUPABASE_SERVICE_ROLE_KEY (base principal)
 *   - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL (base pjn-scraper)
 *   - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY (base pjn-scraper)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Cliente para base de datos principal (gestor-cedulas)
const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente para base de datos pjn-scraper
const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL || mainSupabaseUrl;
const pjnSupabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!mainSupabaseUrl || !mainSupabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno de la base principal');
  console.error('   Requeridas: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!pjnSupabaseUrl || !pjnSupabaseAnonKey) {
  console.error('❌ Error: Faltan variables de entorno de pjn-scraper');
  console.error('   Requeridas: NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL, NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY');
  console.error('   O usar las mismas variables de la base principal si están en la misma DB');
  process.exit(1);
}

const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);
const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);

// Función para parsear expediente
function parseExpediente(expText) {
  if (!expText) return null;
  const match = expText.match(/^([A-Z]+)\s+(\d+)\/(\d+)/);
  if (!match) return null;
  const [, jurisdiccion, numero, anioStr] = match;
  const anio = parseInt(anioStr, 10);
  if (!jurisdiccion || !numero || isNaN(anio)) return null;
  return { jurisdiccion, numero, anio };
}

// Normalizar juzgado
function normalizeJuzgado(raw) {
  if (!raw) return null;
  const j = String(raw).trim().replace(/\s+/g, ' ').toUpperCase();
  const mCivil = /^JUZGADO\s+CIVIL\s+(\d+)\b/i.exec(j);
  if (mCivil) {
    return `JUZGADO CIVIL ${mCivil[1]}`;
  }
  const stripped = j.replace(/\s*-\s*SECRETAR[ÍI]A\s*N[°º]?\s*\d+\s*.*$/i, '').trim();
  return stripped || null;
}

// Función para convertir fecha a DD/MM/YYYY
function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    let date;
    if (typeof dateStr === 'string' && dateStr.includes('/')) {
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
  } catch (e) {
    return null;
  }
}

// Función para extraer observaciones de movimientos
function extractObservaciones(movimientos) {
  if (!movimientos) return null;
  
  try {
    if (Array.isArray(movimientos) && movimientos.length > 0) {
      let tipoActuacion = null;
      let detalle = null;
      
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

async function syncFavoritos() {
  console.log('🔄 Iniciando sincronización de cases a pjn_favoritos...\n');

  try {
    // 1. Leer todos los casos de pjn-scraper (incluyendo columna removido)
    console.log('📋 Leyendo casos de pjn-scraper...');
    const { data: casesData, error: casesErr } = await pjnSupabase
      .from("cases")
      .select("key, expediente, caratula, dependencia, ult_act, situacion, movimientos, removido")
      .order("ult_act", { ascending: false });

    if (casesErr) {
      console.error('❌ Error al leer cases:', casesErr);
      process.exit(1);
    }

    if (!casesData || casesData.length === 0) {
      console.log('⚠️  No hay casos en pjn-scraper');
      process.exit(0);
    }

    console.log(`✅ Encontrados ${casesData.length} casos en pjn-scraper\n`);

    // 2. Convertir casos a formato pjn_favoritos
    console.log('🔄 Convirtiendo casos a formato pjn_favoritos...');
    const favoritosToUpsert = [];
    const casesKeys = new Set(); // Para trackear qué casos existen (NO removidos)
    const removedKeys = new Set(); // Para trackear casos removidos

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
      let fechaUltimaCarga = null;
      let updatedAt = new Date().toISOString();

      if (c.ult_act) {
        try {
          let date;
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
        } catch (e) {
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

    console.log(`✅ ${favoritosToUpsert.length} casos válidos para sincronizar\n`);

    // 3. Upsert en pjn_favoritos
    console.log('💾 Sincronizando casos en pjn_favoritos...');
    let updated = 0;
    const batchSize = 100;

    for (let i = 0; i < favoritosToUpsert.length; i += batchSize) {
      const batch = favoritosToUpsert.slice(i, i + batchSize);
      
      // Eliminar duplicados dentro del lote
      const seen = new Set();
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
        console.error(`❌ Error al hacer upsert del lote ${Math.floor(i / batchSize) + 1}:`, error.message);
        continue;
      }

      updated += data?.length || 0;
      console.log(`   ✅ Lote ${Math.floor(i / batchSize) + 1}: ${data?.length || 0} casos sincronizados`);
    }

    console.log(`\n✅ ${updated} casos insertados/actualizados`);

    // 4. Eliminar de pjn_favoritos los expedientes removidos o que ya no están en cases
    console.log('\n🧹 Eliminando expedientes removidos de favoritos...');
    
    if (removedKeys.size > 0) {
      console.log(`   📋 ${removedKeys.size} casos marcados como removidos en pjn-scraper`);
    }
    
    const { data: currentFavoritos, error: favoritosErr } = await mainSupabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio");

    if (favoritosErr) {
      console.error('❌ Error al leer favoritos actuales:', favoritosErr);
      console.log('\n⚠️  Sincronización parcial completada (no se pudieron eliminar removidos)');
      process.exit(0);
    }

    // Encontrar favoritos que deben eliminarse:
    // 1. Casos marcados como removidos en pjn-scraper
    // 2. Casos que ya no están en cases (fueron eliminados completamente)
    const favoritosToDelete = [];
    
    // Debug: buscar específicamente el expediente 047456/2020
    const debugExpediente = { jurisdiccion: 'CIV', numero: '047456', anio: 2020 };
    const debugKey = `${debugExpediente.jurisdiccion}|${debugExpediente.numero}|${debugExpediente.anio}`;
    const debugKeyAlt = `${debugExpediente.jurisdiccion}|47456|${debugExpediente.anio}`; // Sin ceros a la izquierda
    
    if (currentFavoritos) {
      let debugCount = 0;
      for (const fav of currentFavoritos) {
        // Normalizar número para comparar (agregar ceros a la izquierda si es necesario)
        const numeroNormalizado = String(fav.numero).padStart(6, '0');
        const key = `${fav.jurisdiccion}|${numeroNormalizado}|${fav.anio}`;
        const keyOriginal = `${fav.jurisdiccion}|${fav.numero}|${fav.anio}`;
        
        // También verificar variaciones del número (sin ceros a la izquierda)
        const numeroSinCeros = String(fav.numero).replace(/^0+/, '');
        const keySinCeros = `${fav.jurisdiccion}|${numeroSinCeros}|${fav.anio}`;
        
        // Verificar todas las variaciones posibles
        const isRemoved = removedKeys.has(key) || removedKeys.has(keyOriginal) || removedKeys.has(keySinCeros);
        const notInCases = !casesKeys.has(key) && !casesKeys.has(keyOriginal) && !casesKeys.has(keySinCeros);
        
        const shouldDelete = isRemoved || notInCases;
        
        if (shouldDelete) {
          favoritosToDelete.push(fav.id);
          // Debug: mostrar algunos ejemplos de lo que se va a eliminar
          if (debugCount < 5) {
            console.log(`   🗑️  Eliminar: ${fav.jurisdiccion} ${fav.numero}/${fav.anio} (removido: ${isRemoved}, no en cases: ${notInCases})`);
            debugCount++;
          }
        }
      }
      
      if (favoritosToDelete.length > 5) {
        console.log(`   ... y ${favoritosToDelete.length - 5} más`);
      }
    }

    let deleted = 0;
    if (favoritosToDelete.length > 0) {
      console.log(`   📋 ${favoritosToDelete.length} expedientes a eliminar (removidos o no existentes)...`);
      
      // Eliminar en lotes
      for (let i = 0; i < favoritosToDelete.length; i += batchSize) {
        const batch = favoritosToDelete.slice(i, i + batchSize);
        const { error: deleteErr } = await mainSupabase
          .from("pjn_favoritos")
          .delete()
          .in("id", batch);

        if (deleteErr) {
          console.error(`   ❌ Error al eliminar lote:`, deleteErr.message);
        } else {
          deleted += batch.length;
          console.log(`   ✅ Eliminados ${batch.length} expedientes`);
        }
      }
    } else {
      console.log('   ✅ No hay expedientes para eliminar');
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Resumen de sincronización:');
    console.log(`   ✅ Sincronizados: ${updated} casos`);
    console.log(`   🗑️  Eliminados: ${deleted} expedientes (removidos o no existentes)`);
    console.log(`   🚫 Marcados como removidos: ${removedKeys.size} casos`);
    console.log(`   📋 Total en cases: ${casesData.length}`);
    console.log(`   📋 Total en pjn_favoritos: ${favoritosToUpsert.length}`);
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.error('❌ Error inesperado:', error);
    process.exit(1);
  }
}

// Ejecutar
syncFavoritos()
  .then(() => {
    console.log('✅ Sincronización completada.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
