/**
 * Script para buscar Prueba/Pericia en los movimientos de los expedientes específicos
 * Versión actualizada con la función tienePruebaPericia del frontend
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
const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!pjnSupabaseUrl || !pjnSupabaseAnonKey || !mainSupabaseUrl || !mainSupabaseAnonKey) {
  console.error('❌ Error: Faltan variables de entorno');
  process.exit(1);
}

const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);
const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseAnonKey);

// Función actualizada igual que en el frontend (app/superadmin/page.tsx)
function tienePruebaPericia(movimientos) {
  if (!movimientos) return false;
  
  try {
    // Si movimientos es un string JSON, parsearlo
    let movs = movimientos;
    if (typeof movimientos === 'string') {
      try {
        movs = JSON.parse(movimientos);
      } catch {
        return false;
      }
    }
    
    // Si es un array de objetos
    if (Array.isArray(movs) && movs.length > 0) {
      for (const mov of movs) {
        if (typeof mov === 'object' && mov !== null) {
          // Buscar en el campo "Detalle" o en "cols"
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
              const allColsText = mov.cols.map((col) => String(col)).join(' ').toUpperCase();
              detalleText = allColsText;
            }
          }
          
          // Patrones canónicos para Prueba/Pericia (actualizados)
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
            /GASTOS.*PERITO/i,                      // Nuevo
            /HAGASE\s+SABER.*PERITO/i,              // Nuevo: "HAGASE SABER AL PERITO"
            /TENGASE\s+PRESENTE.*PERITO/i,          // Nuevo: "TENGASE PRESENTE Y HAGASE SABER AL PERITO"
            /INTIMACION.*PERITO/i,                  // Nuevo: "INTIMACION PERITO"
            /INTIMA.*PERITO/i,                      // Nuevo: "INTIMA PERITO"
            /SE\s+INTIME.*PERITO/i,                 // Nuevo: "SE INTIME PERITO"
            /PERITO.*ACOMPAÑA/i,                    // Nuevo: "PERITO ACOMPAÑA"
            /PERITO.*ADJUNTA/i,                     // Nuevo: "PERITO ADJUNTA"
            /NOTIFIQUESE.*PERITO/i,                 // Nuevo: "NOTIFIQUESE...PERITO"
            /NOTIFICA.*PERITO/i                     // Nuevo: "NOTIFICA...PERITO"
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
    console.warn(`[Prueba/Pericia] Error al analizar movimientos:`, err);
  }
  
  return false;
}

// Expedientes específicos mencionados por el usuario
const expedientes = [
  { numero: '17167', anio: '2023', jurisdiccion: 'CIV' },
  { numero: '104244', anio: '2024', jurisdiccion: 'CIV' },
  { numero: '56650', anio: '2023', jurisdiccion: 'CIV' }, // Este SÍ aparece en el filtro según el usuario
  { numero: '46656', anio: '2023', jurisdiccion: 'CIV' }
];

async function searchPericia() {
  console.log('🔍 Buscando Prueba/Pericia en movimientos...\n');

  for (const exp of expedientes) {
    const key = `${exp.jurisdiccion} ${String(exp.numero).padStart(6, '0')}/${exp.anio}`;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 Expediente: ${exp.jurisdiccion} ${exp.numero}/${exp.anio}`);
    console.log(`   Key buscado: "${key}"`);
    
    // 1. Buscar en pjn_favoritos primero (donde están los movimientos sincronizados)
    console.log(`\n   1️⃣  Buscando en pjn_favoritos...`);
    const { data: favoritoData, error: favoritoError } = await mainSupabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, movimientos")
      .eq("jurisdiccion", exp.jurisdiccion)
      .eq("numero", parseInt(exp.numero))
      .eq("anio", parseInt(exp.anio))
      .limit(1);

    if (favoritoError) {
      console.log(`      ❌ Error: ${favoritoError.message}`);
    } else if (favoritoData && favoritoData.length > 0) {
      const favorito = favoritoData[0];
      console.log(`      ✅ Encontrado en pjn_favoritos (ID: ${favorito.id})`);
      
      if (favorito.movimientos) {
        console.log(`      ✅ Tiene movimientos en pjn_favoritos`);
        const tienePericia = tienePruebaPericia(favorito.movimientos);
        console.log(`      Resultado: ${tienePericia ? '✅ SÍ tiene Prueba/Pericia' : '❌ NO tiene Prueba/Pericia'}`);
        
        // Inspeccionar movimientos
        if (Array.isArray(favorito.movimientos)) {
          console.log(`      Total de movimientos: ${favorito.movimientos.length}`);
          inspeccionarMovimientos(favorito.movimientos, 'pjn_favoritos');
        }
      } else {
        console.log(`      ⚠️  No tiene movimientos en pjn_favoritos, buscando en cases...`);
        
        // 2. Buscar en cases como fallback
        const { data: caseData, error: caseError } = await pjnSupabase
          .from("cases")
          .select("key, movimientos")
          .eq("key", key)
          .limit(1);

        if (caseError) {
          console.log(`      ❌ Error en cases: ${caseError.message}`);
        } else if (caseData && caseData.length > 0 && caseData[0].movimientos) {
          console.log(`      ✅ Encontrado en cases`);
          const tienePericia = tienePruebaPericia(caseData[0].movimientos);
          console.log(`      Resultado: ${tienePericia ? '✅ SÍ tiene Prueba/Pericia' : '❌ NO tiene Prueba/Pericia'}`);
          
          if (Array.isArray(caseData[0].movimientos)) {
            inspeccionarMovimientos(caseData[0].movimientos, 'cases');
          }
        } else {
          console.log(`      ❌ No encontrado en cases`);
        }
      }
    } else {
      console.log(`      ❌ No encontrado en pjn_favoritos, buscando en cases...`);
      
      // 2. Buscar en cases como fallback
      const { data: caseData, error: caseError } = await pjnSupabase
        .from("cases")
        .select("key, movimientos")
        .eq("key", key)
        .limit(1);

      if (caseError) {
        console.log(`      ❌ Error en cases: ${caseError.message}`);
      } else if (caseData && caseData.length > 0) {
        if (caseData[0].movimientos) {
          console.log(`      ✅ Encontrado en cases`);
          const tienePericia = tienePruebaPericia(caseData[0].movimientos);
          console.log(`      Resultado: ${tienePericia ? '✅ SÍ tiene Prueba/Pericia' : '❌ NO tiene Prueba/Pericia'}`);
          
          if (Array.isArray(caseData[0].movimientos)) {
            inspeccionarMovimientos(caseData[0].movimientos, 'cases');
          }
        } else {
          console.log(`      ⚠️  Encontrado en cases pero sin movimientos`);
        }
      } else {
        console.log(`      ❌ No encontrado en cases`);
      }
    }
  }
}

function inspeccionarMovimientos(movs, fuente) {
  let encontrado = false;
  for (let i = 0; i < movs.length; i++) {
    const mov = movs[i];
    if (typeof mov === 'object' && mov !== null) {
      let detalleText = '';
      
      if (mov.Detalle) {
        detalleText = String(mov.Detalle).toUpperCase();
      } else if (mov.cols && Array.isArray(mov.cols)) {
        // Buscar "Detalle:" en cualquier parte
        for (const col of mov.cols) {
          const colStr = String(col).trim();
          const matchDetalle = colStr.match(/Detalle:\s*(.+)$/i);
          if (matchDetalle) {
            detalleText = matchDetalle[1].toUpperCase();
            break;
          }
        }
        // Si no se encontró "Detalle:", concatenar todos los cols
        if (!detalleText) {
          detalleText = mov.cols.map((col) => String(col)).join(' ').toUpperCase();
        }
      }
      
      // Buscar cualquier mención de PERICI, PERITO, PRUEBA PERICIAL, etc.
      if (detalleText && /PERICI|PERITO|PRUEBA\s+PERICI/i.test(detalleText)) {
        if (!encontrado) {
          console.log(`\n      📝 Movimientos con texto relacionado (fuente: ${fuente}):`);
          encontrado = true;
        }
        console.log(`\n         Movimiento ${i}:`);
        console.log(`         Detalle completo: ${detalleText.substring(0, 400)}${detalleText.length > 400 ? '...' : ''}`);
        
        // Probar cada patrón
        const patrones = [
          /SE\s+ORDENA.*PERICI/i,
          /ORDENA.*PERICI/i,
          /SOLICITA.*PROVEE.*PRUEBA\s+PERICI/i,
          /PRUEBA\s+PERICIAL/i,
          /PERITO.*ACEPTA\s+(?:EL\s+)?CARGO/i,
          /PERITO.*PRESENTA\s+INFORME/i,
          /PERITO.*FIJA\s+(?:NUEVA\s+)?FECHA/i,
          /PERITO.*INFORMA/i,
          /PERITO.*CITA/i,
          /LLAMA.*PERICI/i,
          /DISPONE.*PERICI/i,
          /TRASLADO.*PERICI/i,
          /PERICI.*M[EÉ]DIC/i,
          /PERICI.*PSICOL/i,
          /PERICI.*CONTAB/i,
          /PERICI.*INGENIER/i,
          /PERICI.*LEGIST/i,
          /ACREDITA.*PERITO/i,
          /ANTICIPO.*PERITO/i,
          /GASTOS.*PERITO/i,
          /HAGASE\s+SABER.*PERITO/i,
          /TENGASE\s+PRESENTE.*PERITO/i,
          /INTIMACION.*PERITO/i,
          /INTIMA.*PERITO/i,
          /SE\s+INTIME.*PERITO/i,
          /PERITO.*ACOMPAÑA/i,
          /PERITO.*ADJUNTA/i,
          /NOTIFIQUESE.*PERITO/i,
          /NOTIFICA.*PERITO/i
        ];
        
        let patronMatch = false;
        for (const patron of patrones) {
          if (patron.test(detalleText)) {
            console.log(`         ✅ Coincide con patrón: ${patron}`);
            patronMatch = true;
            break;
          }
        }
        
        if (!patronMatch) {
          console.log(`         ❌ NO coincide con ningún patrón`);
          console.log(`         ⚠️  Texto contiene PERICI/PERITO pero no coincide con patrones actuales`);
        }
      }
    }
  }
  
  if (!encontrado) {
    console.log(`      ℹ️  No se encontró ninguna mención de Prueba/Pericia en los movimientos`);
  }
}

searchPericia().catch(console.error);
