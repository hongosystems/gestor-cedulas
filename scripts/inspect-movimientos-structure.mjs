/**
 * Script para inspeccionar la estructura real de los movimientos
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
const pjnSupabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;

if (!pjnSupabaseUrl || !pjnSupabaseAnonKey) {
  console.error('❌ Error: Faltan variables de entorno');
  process.exit(1);
}

const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);

const expedientes = [
  { numero: '56650', anio: '2023' },
  { numero: '46656', anio: '2023' },
  { numero: '104244', anio: '2023' },
  { numero: '17167', anio: '2023' }
];

async function inspectMovimientos() {
  console.log('🔍 Inspeccionando estructura de movimientos...\n');

  for (const exp of expedientes) {
    const key = `CIV ${String(exp.numero).padStart(6, '0')}/${exp.anio}`;
    
    const { data, error } = await pjnSupabase
      .from("cases")
      .select("key, movimientos")
      .eq("key", key)
      .limit(1);

    if (data && data.length > 0 && data[0].movimientos) {
      console.log(`\n📋 Expediente: ${exp.numero}/${exp.anio}`);
      console.log(`   Key: ${key}`);
      
      const movs = data[0].movimientos;
      
      // Verificar tipo
      console.log(`   Tipo de movimientos: ${typeof movs}`);
      console.log(`   Es array: ${Array.isArray(movs)}`);
      
      if (Array.isArray(movs)) {
        console.log(`   Cantidad de movimientos: ${movs.length}`);
        
        // Mostrar estructura del primer movimiento
        if (movs.length > 0) {
          console.log(`   \n   Primer movimiento:`);
          console.log(`   - Tipo: ${typeof movs[0]}`);
          console.log(`   - Es objeto: ${typeof movs[0] === 'object' && movs[0] !== null}`);
          
          if (typeof movs[0] === 'object' && movs[0] !== null) {
            console.log(`   - Claves: ${Object.keys(movs[0]).join(', ')}`);
            
            // Buscar campos que contengan "perici" o "prueba"
            const movStr = JSON.stringify(movs[0]).toUpperCase();
            if (/PERICI|PRUEBA/.test(movStr)) {
              console.log(`   ⚠️  CONTIENE "PERICI" o "PRUEBA" en algún campo!`);
              
              // Mostrar el campo completo
              Object.keys(movs[0]).forEach(key => {
                const value = String(movs[0][key] || '');
                if (/perici|prueba/i.test(value)) {
                  console.log(`   - Campo "${key}": ${value.substring(0, 200)}...`);
                }
              });
            }
            
            // Mostrar estructura de Detalle
            if (movs[0].Detalle) {
              console.log(`   - Detalle existe: ${typeof movs[0].Detalle}`);
              console.log(`   - Detalle valor: ${String(movs[0].Detalle).substring(0, 150)}...`);
            }
            
            // Mostrar estructura de cols
            if (movs[0].cols) {
              console.log(`   - cols existe: ${Array.isArray(movs[0].cols)}`);
              if (Array.isArray(movs[0].cols)) {
                console.log(`   - cols cantidad: ${movs[0].cols.length}`);
                movs[0].cols.forEach((col, idx) => {
                  const colStr = String(col);
                  if (/perici|prueba|detalle/i.test(colStr)) {
                    console.log(`   - cols[${idx}]: ${colStr.substring(0, 150)}...`);
                  }
                });
              }
            }
          }
          
          // Buscar en TODOS los movimientos
          let encontrado = false;
          for (let i = 0; i < Math.min(5, movs.length); i++) {
            const movStr = JSON.stringify(movs[i]).toUpperCase();
            if (/PERICI|PRUEBA/.test(movStr)) {
              if (!encontrado) {
                console.log(`   \n   ⚠️  Movimiento ${i} contiene "PERICI" o "PRUEBA":`);
                encontrado = true;
              }
              console.log(`   - Movimiento ${i}: ${JSON.stringify(movs[i]).substring(0, 200)}...`);
            }
          }
        }
      }
    } else {
      console.log(`\n❌ Expediente ${exp.numero}/${exp.anio} no encontrado o sin movimientos`);
    }
  }
}

inspectMovimientos();
