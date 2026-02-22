/**
 * Script para diagnosticar cuántos expedientes DEBERÍAN estar en Prueba/Pericia
 * pero NO están siendo filtrados correctamente
 * 
 * Uso:
 *   node scripts/diagnose-prueba-pericia.mjs
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Cliente para base de datos principal
const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente para base de datos pjn-scraper
const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL || mainSupabaseUrl;
const pjnSupabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!mainSupabaseUrl || !mainSupabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno de la base principal');
  process.exit(1);
}

if (!pjnSupabaseUrl || !pjnSupabaseAnonKey) {
  console.error('❌ Error: Faltan variables de entorno de pjn-scraper');
  process.exit(1);
}

const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);
const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);

// Función para detectar Prueba/Pericia (igual que en el frontend)
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
            for (const col of mov.cols) {
              const colStr = String(col).trim();
              const matchDetalle = colStr.match(/^Detalle:\s*(.+)$/i);
              if (matchDetalle) {
                detalleText = matchDetalle[1].toUpperCase();
                break;
              }
            }
          }
          
          const patrones = [
            /SE\s+ORDENA.*PERICI/i,
            /ORDENA.*PERICI/i,
            /SOLICITA.*PROVEE.*PRUEBA\s+PERICI/i,
            /PRUEBA\s+PERICIAL/i,
            /PERITO.*ACEPTA\s+CARGO/i,
            /LLAMA.*PERICI/i,
            /DISPONE.*PERICI/i,
            /TRASLADO.*PERICI/i,
            /PERICI.*M[EÉ]DIC/i,
            /PERICI.*PSICOL/i,
            /PERICI.*CONTAB/i
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

async function diagnosePruebaPericia() {
  console.log('🔍 Diagnosticando expedientes que DEBERÍAN estar en Prueba/Pericia...\n');

  try {
    // 1. Obtener todos los favoritos
    console.log('📊 Obteniendo todos los favoritos de pjn_favoritos...');
    const { data: favoritos, error: favoritosErr } = await mainSupabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, movimientos")
      .order("anio", { ascending: false })
      .order("numero", { ascending: false });

    if (favoritosErr) {
      console.error('❌ Error al leer pjn_favoritos:', favoritosErr);
      process.exit(1);
    }

    if (!favoritos || favoritos.length === 0) {
      console.log('⚠️  No se encontraron favoritos');
      process.exit(0);
    }

    console.log(`✅ Encontrados ${favoritos.length} favoritos\n`);

    // 2. Estadísticas iniciales
    let conMovimientosEnFavoritos = 0;
    let conPruebaPericiaEnFavoritos = 0;
    let sinMovimientosEnFavoritos = 0;

    // 3. Para cada favorito sin movimientos, buscar en cases
    const favoritosSinMovimientos = favoritos.filter(f => !f.movimientos);
    console.log(`📋 Favoritos SIN movimientos en pjn_favoritos: ${favoritosSinMovimientos.length}`);
    console.log(`📋 Favoritos CON movimientos en pjn_favoritos: ${favoritos.length - favoritosSinMovimientos.length}\n`);

    // 4. Verificar cuántos tienen Prueba/Pericia en sus movimientos (si los tienen)
    for (const fav of favoritos) {
      if (fav.movimientos) {
        conMovimientosEnFavoritos++;
        if (tienePruebaPericia(fav.movimientos)) {
          conPruebaPericiaEnFavoritos++;
        }
      } else {
        sinMovimientosEnFavoritos++;
      }
    }

    console.log(`📊 Estadísticas de pjn_favoritos:`);
    console.log(`   - Con movimientos: ${conMovimientosEnFavoritos}`);
    console.log(`   - Con Prueba/Pericia detectada: ${conPruebaPericiaEnFavoritos}`);
    console.log(`   - Sin movimientos: ${sinMovimientosEnFavoritos}\n`);

    // 5. Buscar en cases usando el formato CORRECTO del key (con |)
    console.log('🔍 Buscando movimientos en cases usando formato CORRECTO del key (JURISDICCION|NUMERO|ANIO)...');
    
    let encontradosEnCases = 0;
    let conPruebaPericiaEnCases = 0;
    let noEncontradosEnCases = 0;
    const expedientesConProblema = [];

    // Procesar en lotes para no sobrecargar
    const batchSize = 100;
    for (let i = 0; i < favoritosSinMovimientos.length; i += batchSize) {
      const batch = favoritosSinMovimientos.slice(i, i + batchSize);
      
      // Construir keys en formato CORRECTO (con |)
      const keys = batch
        .filter(f => f.jurisdiccion && f.numero && f.anio)
        .map(f => {
          const numeroNormalizado = String(f.numero).padStart(6, '0');
          return `${f.jurisdiccion}|${numeroNormalizado}|${f.anio}`;
        });

      if (keys.length > 0) {
        const { data: casesData, error: casesErr } = await pjnSupabase
          .from("cases")
          .select("key, movimientos")
          .in("key", keys);

        if (casesErr) {
          console.warn(`⚠️  Error al leer batch ${Math.floor(i / batchSize) + 1}:`, casesErr.message);
          continue;
        }

        if (casesData) {
          const casesMap = new Map();
          casesData.forEach(c => {
            if (c.movimientos) {
              casesMap.set(c.key, c.movimientos);
            }
          });

          // Verificar cada favorito del batch
          for (const fav of batch) {
            if (fav.jurisdiccion && fav.numero && fav.anio) {
              const numeroNormalizado = String(fav.numero).padStart(6, '0');
              const keyCorrecto = `${fav.jurisdiccion}|${numeroNormalizado}|${fav.anio}`;
              
              const movimientos = casesMap.get(keyCorrecto);
              if (movimientos) {
                encontradosEnCases++;
                if (tienePruebaPericia(movimientos)) {
                  conPruebaPericiaEnCases++;
                  expedientesConProblema.push({
                    jurisdiccion: fav.jurisdiccion,
                    numero: fav.numero,
                    anio: fav.anio,
                    key: keyCorrecto,
                    tieneMovimientosEnCases: true,
                    tienePruebaPericia: true
                  });
                }
              } else {
                noEncontradosEnCases++;
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
    console.log(`   - Con Prueba/Pericia detectada: ${conPruebaPericiaEnCases}`);
    console.log(`   - No encontrados en cases: ${noEncontradosEnCases}\n`);

    // 6. Verificar también con el formato INCORRECTO (el que usa el frontend actualmente)
    console.log('🔍 Verificando formato INCORRECTO del key (JURISDICCION NUMERO/ANIO) que usa el frontend...');
    
    let encontradosConFormatoIncorrecto = 0;
    let conPruebaPericiaFormatoIncorrecto = 0;

    const batchIncorrecto = favoritosSinMovimientos.slice(0, Math.min(100, favoritosSinMovimientos.length));
    const keysIncorrectos = batchIncorrecto
      .filter(f => f.jurisdiccion && f.numero && f.anio)
      .map(f => {
        const numeroNormalizado = String(f.numero).padStart(6, '0');
        return `${f.jurisdiccion} ${numeroNormalizado}/${f.anio}`;
      });

    if (keysIncorrectos.length > 0) {
      const { data: casesDataIncorrecto } = await pjnSupabase
        .from("cases")
        .select("key, movimientos")
        .in("key", keysIncorrectos);

      if (casesDataIncorrecto) {
        encontradosConFormatoIncorrecto = casesDataIncorrecto.length;
        casesDataIncorrecto.forEach(c => {
          if (c.movimientos && tienePruebaPericia(c.movimientos)) {
            conPruebaPericiaFormatoIncorrecto++;
          }
        });
      }
    }

    console.log(`   - Encontrados con formato INCORRECTO (muestra de 100): ${encontradosConFormatoIncorrecto}`);
    console.log(`   - Con Prueba/Pericia (formato incorrecto): ${conPruebaPericiaFormatoIncorrecto}\n`);

    // 7. Resumen final
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📈 RESUMEN FINAL');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\n✅ Expedientes que DEBERÍAN estar en Prueba/Pericia:`);
    console.log(`   - Con movimientos en pjn_favoritos: ${conPruebaPericiaEnFavoritos}`);
    console.log(`   - Con movimientos en cases (formato correcto): ${conPruebaPericiaEnCases}`);
    console.log(`   - TOTAL que deberían estar filtrados: ${conPruebaPericiaEnFavoritos + conPruebaPericiaEnCases}`);
    console.log(`\n❌ Expedientes que NO están siendo filtrados:`);
    console.log(`   - Tienen Prueba/Pericia en cases pero NO en pjn_favoritos: ${conPruebaPericiaEnCases}`);
    console.log(`\n🔧 Problema identificado:`);
    console.log(`   - El frontend usa formato INCORRECTO del key: "JURISDICCION NUMERO/ANIO"`);
    console.log(`   - La tabla cases usa formato CORRECTO: "JURISDICCION|NUMERO|ANIO"`);
    console.log(`   - Por eso NO encuentra los movimientos y NO puede filtrar correctamente\n`);

    // 8. Mostrar algunos ejemplos
    if (expedientesConProblema.length > 0) {
      console.log('📋 Ejemplos de expedientes con Prueba/Pericia que NO se están filtrando:');
      expedientesConProblema.slice(0, 10).forEach(exp => {
        console.log(`   - ${exp.jurisdiccion} ${exp.numero}/${exp.anio}`);
      });
      if (expedientesConProblema.length > 10) {
        console.log(`   ... y ${expedientesConProblema.length - 10} más`);
      }
      console.log('');
    }

  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

diagnosePruebaPericia();
