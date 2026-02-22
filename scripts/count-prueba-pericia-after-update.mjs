/**
 * Script para contar cuántos expedientes quedarían en Prueba/Pericia
 * después de actualizar los patrones
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
const pjnSupabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;

if (!mainSupabaseUrl || !mainSupabaseServiceKey || !pjnSupabaseUrl || !pjnSupabaseAnonKey) {
  console.error('❌ Error: Faltan variables de entorno');
  process.exit(1);
}

const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);
const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);

// Función ACTUALIZADA con los nuevos patrones
function tienePruebaPericia(movimientos) {
  if (!movimientos) return false;
  
  try {
    let movs = movimientos;
    if (typeof movimientos === 'string') {
      try {
        movs = JSON.parse(movimientos);
      } catch {
        return false;
      }
    }
    
    if (Array.isArray(movs) && movs.length > 0) {
      for (const mov of movs) {
        if (typeof mov === 'object' && mov !== null) {
          let detalleText = '';
          
          if (mov.Detalle) {
            detalleText = String(mov.Detalle).toUpperCase();
          } else if (mov.cols && Array.isArray(mov.cols)) {
            // Buscar en cols el campo "Detalle:" (puede estar en cualquier posición del array)
            for (const col of mov.cols) {
              const colStr = String(col).trim();
              // Buscar "Detalle:" al inicio o en cualquier parte
              const matchDetalle = colStr.match(/Detalle:\s*(.+)$/i);
              if (matchDetalle) {
                detalleText = matchDetalle[1].toUpperCase();
                break;
              }
            }
            // Si no se encontró "Detalle:", buscar los patrones directamente en todos los cols
            if (!detalleText) {
              const allColsText = mov.cols.map(col => String(col)).join(' ').toUpperCase();
              detalleText = allColsText;
            }
          }
          
          // Patrones canónicos ACTUALIZADOS para Prueba/Pericia
          const patrones = [
            /SE\s+ORDENA.*PERICI/i,
            /ORDENA.*PERICI/i,
            /SOLICITA.*PROVEE.*PRUEBA\s+PERICI/i,
            /PRUEBA\s+PERICIAL/i,
            /PERITO.*ACEPTA\s+(?:EL\s+)?CARGO/i,  // Mejorado: acepta "EL CARGO" o "CARGO"
            /PERITO.*PRESENTA\s+INFORME/i,         // Nuevo
            /PERITO.*FIJA\s+(?:NUEVA\s+)?FECHA/i, // Nuevo
            /PERITO.*INFORMA/i,                    // Nuevo
            /PERITO.*CITA/i,                       // Nuevo
            /LLAMA.*PERICI/i,
            /DISPONE.*PERICI/i,
            /TRASLADO.*PERICI/i,
            /PERICI.*M[EÉ]DIC/i,
            /PERICI.*PSICOL/i,
            /PERICI.*CONTAB/i,
            /PERICI.*INGENIER/i,                   // Nuevo
            /PERICI.*LEGIST/i,                      // Nuevo
            /ACREDITA.*PERITO/i,                    // Nuevo: para "ACREDITA ANTICIPO DE GASTOS PERITO"
            /ANTICIPO.*PERITO/i,                    // Nuevo
            /GASTOS.*PERITO/i                       // Nuevo
          ];
          
          for (const patron of patrones) {
            if (patron.test(detalleText)) {
              return true;
            }
          }
        }
      }
    }
  } catch (err) {
    return false;
  }
  
  return false;
}

async function countPruebaPericia() {
  console.log('🔍 Contando expedientes con Prueba/Pericia (con patrones actualizados)...\n');

  try {
    // 1. Obtener todos los favoritos
    console.log('📊 Obteniendo todos los favoritos...');
    const { data: favoritos, error: favoritosErr } = await mainSupabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, movimientos")
      .order("anio", { ascending: false });

    if (favoritosErr) {
      console.error('❌ Error al leer pjn_favoritos:', favoritosErr);
      process.exit(1);
    }

    if (!favoritos || favoritos.length === 0) {
      console.log('⚠️  No se encontraron favoritos');
      process.exit(0);
    }

    console.log(`✅ Encontrados ${favoritos.length} favoritos\n`);

    // 2. Contar con movimientos en pjn_favoritos
    let conMovimientos = 0;
    let conPruebaPericiaEnFavoritos = 0;
    let sinMovimientos = 0;

    for (const fav of favoritos) {
      if (fav.movimientos) {
        conMovimientos++;
        if (tienePruebaPericia(fav.movimientos)) {
          conPruebaPericiaEnFavoritos++;
        }
      } else {
        sinMovimientos++;
      }
    }

    console.log(`📊 Estadísticas de pjn_favoritos:`);
    console.log(`   - Con movimientos: ${conMovimientos}`);
    console.log(`   - Con Prueba/Pericia detectada: ${conPruebaPericiaEnFavoritos}`);
    console.log(`   - Sin movimientos: ${sinMovimientos}\n`);

    // 3. Buscar en cases para los que no tienen movimientos en pjn_favoritos
    console.log('🔍 Buscando movimientos en cases para favoritos sin movimientos...');
    
    const favoritosSinMovimientos = favoritos.filter(f => !f.movimientos);
    let encontradosEnCases = 0;
    let conPruebaPericiaEnCases = 0;

    // Procesar en lotes
    const batchSize = 100;
    for (let i = 0; i < favoritosSinMovimientos.length; i += batchSize) {
      const batch = favoritosSinMovimientos.slice(i, i + batchSize);
      
      // Construir keys en formato correcto (con espacios y /)
      const keys = batch
        .filter(f => f.jurisdiccion && f.numero && f.anio)
        .map(f => {
          const numeroNormalizado = String(f.numero).padStart(6, '0');
          return `${f.jurisdiccion} ${numeroNormalizado}/${f.anio}`;
        });

      if (keys.length > 0) {
        const { data: casesData, error: casesErr } = await pjnSupabase
          .from("cases")
          .select("key, movimientos")
          .in("key", keys);

        if (!casesErr && casesData) {
          const casesMap = new Map();
          casesData.forEach(c => {
            if (c.movimientos) {
              casesMap.set(c.key, c.movimientos);
            }
          });

          for (const fav of batch) {
            if (fav.jurisdiccion && fav.numero && fav.anio) {
              const numeroNormalizado = String(fav.numero).padStart(6, '0');
              const key = `${fav.jurisdiccion} ${numeroNormalizado}/${fav.anio}`;
              
              const movimientos = casesMap.get(key);
              if (movimientos) {
                encontradosEnCases++;
                if (tienePruebaPericia(movimientos)) {
                  conPruebaPericiaEnCases++;
                }
              }
            }
          }
        }
      }

      // Mostrar progreso
      if ((i + batchSize) % 500 === 0 || i + batchSize >= favoritosSinMovimientos.length) {
        console.log(`   Procesados ${Math.min(i + batchSize, favoritosSinMovimientos.length)} de ${favoritosSinMovimientos.length}...`);
      }
    }

    console.log('\n📊 Estadísticas de cases:');
    console.log(`   - Encontrados en cases: ${encontradosEnCases}`);
    console.log(`   - Con Prueba/Pericia detectada: ${conPruebaPericiaEnCases}\n`);

    // 4. Resumen final
    const totalConPruebaPericia = conPruebaPericiaEnFavoritos + conPruebaPericiaEnCases;

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📈 RESUMEN FINAL (CON PATRONES ACTUALIZADOS)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\n✅ TOTAL de expedientes con Prueba/Pericia: ${totalConPruebaPericia}`);
    console.log(`   - Con movimientos en pjn_favoritos: ${conPruebaPericiaEnFavoritos}`);
    console.log(`   - Con movimientos en cases: ${conPruebaPericiaEnCases}`);
    console.log(`\n📊 De un total de ${favoritos.length} favoritos`);
    console.log(`   - ${((totalConPruebaPericia / favoritos.length) * 100).toFixed(2)}% tienen Prueba/Pericia\n`);

  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

countPruebaPericia();
