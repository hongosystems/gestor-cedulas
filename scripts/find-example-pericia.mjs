/**
 * Script para encontrar un ejemplo de expediente que SÍ tenga Prueba/Pericia
 * y ver su estructura
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

// Función igual que en el frontend
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

async function findExample() {
  console.log('🔍 Buscando expedientes que SÍ tienen Prueba/Pericia en pjn_favoritos...\n');

  // Obtener favoritos con movimientos que tienen Prueba/Pericia
  const { data: favoritos, error } = await mainSupabase
    .from("pjn_favoritos")
    .select("jurisdiccion, numero, anio, movimientos")
    .not("movimientos", "is", null)
    .limit(100);

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  if (!favoritos || favoritos.length === 0) {
    console.log('⚠️  No se encontraron favoritos con movimientos');
    return;
  }

  console.log(`📊 Revisando ${favoritos.length} favoritos con movimientos...\n`);

  let encontrados = 0;
  for (const fav of favoritos) {
    if (tienePruebaPericia(fav.movimientos)) {
      encontrados++;
      console.log(`\n✅ Expediente con Prueba/Pericia: ${fav.jurisdiccion} ${fav.numero}/${fav.anio}`);
      
      // Mostrar estructura del primer movimiento que tiene Prueba/Pericia
      const movs = fav.movimientos;
      if (Array.isArray(movs)) {
        for (let i = 0; i < movs.length; i++) {
          const mov = movs[i];
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
            
            // Verificar si este movimiento tiene Prueba/Pericia
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
            
            let tienePatron = false;
            for (const patron of patrones) {
              if (patron.test(detalleText)) {
                tienePatron = true;
                break;
              }
            }
            
            if (tienePatron) {
              console.log(`   Movimiento ${i} que tiene Prueba/Pericia:`);
              console.log(`   - Estructura: ${JSON.stringify(Object.keys(mov))}`);
              if (mov.Detalle) {
                console.log(`   - Detalle: ${String(mov.Detalle).substring(0, 200)}...`);
              }
              if (mov.cols) {
                console.log(`   - cols: ${JSON.stringify(mov.cols)}`);
              }
              break; // Solo mostrar el primero
            }
          }
        }
      }
      
      if (encontrados >= 3) break; // Solo mostrar 3 ejemplos
    }
  }

  console.log(`\n📊 Total encontrados: ${encontrados} de ${favoritos.length} revisados`);
}

findExample();
