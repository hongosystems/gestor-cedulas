/**
 * Script para migrar datos de la tabla cases (pjn-scraper) a pjn_favoritos (base principal)
 * 
 * Uso:
 *   node scripts/migrate_cases_to_pjn_favoritos.mjs
 * 
 * Requiere variables de entorno:
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

// Función para parsear expediente (ej: "CIV 106590/2024" -> {jurisdiccion: "CIV", numero: "106590", anio: 2024})
function parseExpediente(expText) {
  if (!expText) return null;
  
  const match = expText.match(/^([A-Z]+)\s+(\d+)\/(\d+)/);
  if (!match) return null;
  
  const [, jurisdiccion, numero, anioStr] = match;
  const anio = parseInt(anioStr, 10);
  
  if (!jurisdiccion || !numero || isNaN(anio)) return null;
  
  return { jurisdiccion, numero, anio };
}

// Normalizar juzgado para guardar SIN "- SECRETARIA N° X"
// Ej:
// - "JUZGADO CIVIL 89 - SECRETARIA N° 2" -> "JUZGADO CIVIL 89"
// - "JUZGADO CIVIL 8" -> "JUZGADO CIVIL 8"
// - otros valores: intenta recortar sufijo de Secretaría si existe
function normalizeJuzgado(raw) {
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
function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    const dia = String(date.getDate()).padStart(2, '0');
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const anio = date.getFullYear();
    return `${dia}/${mes}/${anio}`;
  } catch (e) {
    return null;
  }
}

async function migrateCases() {
  console.log('🔄 Iniciando migración de cases a pjn_favoritos...\n');

  try {
    // Función para extraer observaciones de movimientos (mismo criterio que autocompletado)
    function extractObservaciones(movimientos) {
      if (!movimientos) return null;
      
      try {
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
                  break;
                }
              }
            }
          }
          
          // Si encontramos ambos, formatear el resultado
          if (tipoActuacion && detalle) {
            return `${tipoActuacion}\n${detalle}`;
          }
        }
      } catch (err) {
        console.warn(`⚠️  Error al extraer observaciones:`, err);
      }
      
      return null;
    }

    // 1. Leer datos de cases desde pjn-scraper (incluyendo movimientos)
    console.log('📋 Leyendo datos de la tabla cases...');
    const { data: casesData, error: casesErr } = await pjnSupabase
      .from("cases")
      .select("key, expediente, caratula, dependencia, ult_act, situacion, movimientos")
      .order("ult_act", { ascending: false })
      .limit(5000); // Limitar para no sobrecargar
    
    if (casesErr) {
      console.error('❌ Error al leer cases:', casesErr);
      process.exit(1);
    }
    
    if (!casesData || casesData.length === 0) {
      console.warn('⚠️  No hay datos en la tabla cases');
      process.exit(0);
    }
    
    console.log(`✅ Encontrados ${casesData.length} casos en la tabla cases\n`);
    
    // 2. Convertir y filtrar casos válidos
    console.log('🔄 Convirtiendo casos a formato pjn_favoritos...');
    const favoritosToInsert = [];
    let skipped = 0;
    
    for (const c of casesData) {
      const expText = c.key || c.expediente;
      const parsed = parseExpediente(expText);
      
      if (!parsed) {
        skipped++;
        continue;
      }
      
      // No verificar si existe - siempre intentar insertar/actualizar con upsert
      
      // Manejar fecha de manera segura
      let fechaUltimaCarga = null;
      let updatedAt = new Date().toISOString();
      
      if (c.ult_act) {
        try {
          // ult_act puede venir en formato DD/MM/YYYY o ISO
          let date;
          if (typeof c.ult_act === 'string' && c.ult_act.includes('/')) {
            // Formato DD/MM/YYYY
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
            // Fecha válida - convertir a DD/MM/YYYY para fecha_ultima_carga
            fechaUltimaCarga = formatDate(date.toISOString());
            updatedAt = date.toISOString();
          }
        } catch (e) {
          // Fecha inválida, usar valores por defecto
        }
      }
      
      // Extraer observaciones de movimientos
      const observaciones = extractObservaciones(c.movimientos);
      
      favoritosToInsert.push({
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
    
    console.log(`✅ ${favoritosToInsert.length} casos válidos para insertar`);
    console.log(`   ${skipped} casos omitidos (ya existen o formato inválido)\n`);
    
    if (favoritosToInsert.length === 0) {
      console.log('✅ No hay casos nuevos para migrar. Todos ya están en pjn_favoritos.');
      process.exit(0);
    }
    
    // 3. Insertar en lotes
    console.log('💾 Insertando casos en pjn_favoritos...');
    const batchSize = 100;
    let inserted = 0;
    let errors = 0;
    
    for (let i = 0; i < favoritosToInsert.length; i += batchSize) {
      const batch = favoritosToInsert.slice(i, i + batchSize);
      
      // Eliminar duplicados dentro del lote (basado en jurisdiccion, numero, anio)
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
        console.log(`   ⚠️  Lote ${Math.floor(i / batchSize) + 1}: Todos los casos eran duplicados dentro del lote`);
        continue;
      }
      
      // Usar upsert para evitar duplicados (basado en la constraint única)
      const { data, error } = await mainSupabase
        .from("pjn_favoritos")
        .upsert(uniqueBatch, { 
          onConflict: "jurisdiccion,numero,anio",
          ignoreDuplicates: false // Actualizar si existe
        })
        .select("id");
      
      if (error) {
        console.error(`❌ Error al insertar/actualizar lote ${Math.floor(i / batchSize) + 1}:`, error.message);
        // Intentar insertar uno por uno para ver cuáles fallan
        for (const item of uniqueBatch) {
          try {
            const { error: singleError } = await mainSupabase
              .from("pjn_favoritos")
              .upsert(item, { 
                onConflict: "jurisdiccion,numero,anio"
              });
            if (!singleError) {
              inserted++;
            } else {
              errors++;
              console.error(`   ⚠️  Error con caso ${item.jurisdiccion} ${item.numero}/${item.anio}:`, singleError.message);
            }
          } catch (e) {
            errors++;
          }
        }
      } else {
        inserted += data?.length || 0;
        const duplicatesInBatch = batch.length - uniqueBatch.length;
        if (duplicatesInBatch > 0) {
          console.log(`   ✅ Lote ${Math.floor(i / batchSize) + 1}: ${data?.length || 0} casos insertados/actualizados (${duplicatesInBatch} duplicados eliminados del lote)`);
        } else {
          console.log(`   ✅ Lote ${Math.floor(i / batchSize) + 1}: ${data?.length || 0} casos insertados/actualizados`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Resumen de migración:');
    console.log(`   ✅ Insertados: ${inserted} casos`);
    if (errors > 0) {
      console.log(`   ⚠️  Errores: ${errors} casos`);
    }
    console.log(`   📋 Total en cases: ${casesData.length}`);
    console.log('='.repeat(50) + '\n');
    
    // 4. Verificar resultado final
    const { count: finalCount } = await mainSupabase
      .from("pjn_favoritos")
      .select("*", { count: "exact", head: true });
    
    console.log(`✅ Total de registros en pjn_favoritos: ${finalCount}`);
    
  } catch (error) {
    console.error('❌ Error inesperado:', error);
    process.exit(1);
  }
}

// Ejecutar
migrateCases()
  .then(() => {
    console.log('\n✅ Migración completada.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
