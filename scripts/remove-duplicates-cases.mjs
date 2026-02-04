/**
 * Script para eliminar duplicados en la tabla cases de pjn-scraper
 * 
 * Identifica duplicados basándose en el número de expediente (ej: "047456/2020")
 * y mantiene el registro más reciente o el que tenga más información.
 * 
 * Uso:
 *   node scripts/remove-duplicates-cases.mjs
 * 
 * Requiere variables de entorno (cargadas desde .env.local):
 *   - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL (base pjn-scraper)
 *   - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY (base pjn-scraper)
 *   - SUPABASE_SERVICE_ROLE_KEY (base pjn-scraper) - Para poder eliminar
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Intentar cargar desde .env.local, si no existe, cargar desde .env
const envPath = join(__dirname, '..', '.env.local');
const envPathAlt = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });
dotenv.config({ path: envPathAlt }); // También intentar .env si .env.local no existe

// Cliente para base de datos pjn-scraper
// Las bases están en diferentes proyectos de Supabase
// Buscar en múltiples variables de entorno posibles
const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL 
  || process.env.PJN_SCRAPER_SUPABASE_URL 
  || process.env.SUPABASE_URL; // Para compatibilidad con variables directas

const pjnSupabaseServiceKey = process.env.PJN_SCRAPER_SERVICE_ROLE_KEY 
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Debug: mostrar qué variables se encontraron
console.log('🔍 Verificando variables de entorno...');
console.log(`   NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL: ${process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL ? '✅' : '❌'}`);
console.log(`   PJN_SCRAPER_SUPABASE_URL: ${process.env.PJN_SCRAPER_SUPABASE_URL ? '✅' : '❌'}`);
console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
console.log(`   PJN_SCRAPER_SERVICE_ROLE_KEY: ${process.env.PJN_SCRAPER_SERVICE_ROLE_KEY ? `✅ (${process.env.PJN_SCRAPER_SERVICE_ROLE_KEY.substring(0, 20)}...)` : '❌'}`);
console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? `✅ (${process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 20)}...)` : '❌'}`);
console.log('');

if (!pjnSupabaseUrl) {
  console.error('❌ Error: Falta NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL o PJN_SCRAPER_SUPABASE_URL');
  console.error('   Configura en .env.local:');
  console.error('   - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL=https://npfcgsrrhhmwywierpbf.supabase.co');
  console.error('   O:');
  console.error('   - PJN_SCRAPER_SUPABASE_URL=https://npfcgsrrhhmwywierpbf.supabase.co');
  process.exit(1);
}

if (!pjnSupabaseServiceKey) {
  console.error('❌ Error: Falta PJN_SCRAPER_SERVICE_ROLE_KEY o SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Configura en .env.local:');
  console.error('   - PJN_SCRAPER_SERVICE_ROLE_KEY=tu_service_role_key_de_pjn_scraper');
  console.error('   O:');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_de_pjn_scraper');
  console.error('\n   Obtén la service_role key desde:');
  console.error('   Supabase Dashboard de pjn-scraper → Settings → API → service_role key (secret)');
  process.exit(1);
}

// Validar que la URL y la key correspondan a pjn-scraper
if (pjnSupabaseUrl && !pjnSupabaseUrl.includes('npfcgsrrhhmwywierpbf')) {
  console.warn('⚠️  Advertencia: La URL no parece ser de pjn-scraper');
  console.warn(`   URL encontrada: ${pjnSupabaseUrl}`);
  console.warn('   URL esperada: https://npfcgsrrhhmwywierpbf.supabase.co');
}

// Si está usando SUPABASE_SERVICE_ROLE_KEY pero la URL es de pjn-scraper, advertir
if (pjnSupabaseServiceKey === process.env.SUPABASE_SERVICE_ROLE_KEY && 
    pjnSupabaseUrl && pjnSupabaseUrl.includes('npfcgsrrhhmwywierpbf') &&
    !process.env.PJN_SCRAPER_SERVICE_ROLE_KEY) {
  console.warn('⚠️  Advertencia: Estás usando SUPABASE_SERVICE_ROLE_KEY para pjn-scraper');
  console.warn('   Asegúrate de que esta key corresponda a la base de datos de pjn-scraper');
  console.warn('   Recomendado: Usa PJN_SCRAPER_SERVICE_ROLE_KEY específicamente para pjn-scraper');
  console.log('');
}

// Usar service role key (necesario para eliminar)
const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseServiceKey);

// Función para normalizar número de expediente
// Extrae el número y año: "CIV 047456/2020" -> "047456/2020"
// También maneja variaciones como "CIV 47456/2020" -> "047456/2020"
function normalizeExpediente(expText) {
  if (!expText) return null;
  
  // Intentar extraer número/año directamente
  const match = expText.match(/(\d+)\/(\d{4})/);
  if (match) {
    const [, numero, anio] = match;
    // Normalizar número a 6 dígitos con ceros a la izquierda
    const numeroNormalizado = numero.padStart(6, '0');
    return `${numeroNormalizado}/${anio}`;
  }
  
  return null;
}

// Función para obtener un score de "completitud" de un caso
// Cuanto mayor el score, más información tiene el registro
function getCompletenessScore(caseRecord) {
  let score = 0;
  
  if (caseRecord.caratula) score += 10;
  if (caseRecord.dependencia) score += 5;
  if (caseRecord.ult_act) score += 5;
  if (caseRecord.situacion) score += 3;
  if (caseRecord.movimientos && Array.isArray(caseRecord.movimientos) && caseRecord.movimientos.length > 0) {
    score += caseRecord.movimientos.length;
  }
  
  return score;
}

async function removeDuplicates() {
  console.log('🔄 Iniciando eliminación de duplicados en cases...\n');
  console.log(`📡 Conectando a: ${pjnSupabaseUrl ? pjnSupabaseUrl.substring(0, 30) + '...' : 'N/A'}\n`);

  try {
    // 1. Leer todos los casos
    console.log('📋 Leyendo todos los casos de pjn-scraper...');
    // Nota: La tabla cases no tiene columna 'id', usa 'key' como identificador
    const { data: casesData, error: casesErr } = await pjnSupabase
      .from("cases")
      .select("key, expediente, caratula, dependencia, ult_act, situacion, movimientos, removido")
      .order("ult_act", { ascending: false });

    if (casesErr) {
      console.error('❌ Error al leer cases:', casesErr);
      if (casesErr.message?.includes('Invalid API key') || casesErr.message?.includes('API key')) {
        console.error('\n💡 Solución:');
        console.error('   - Verifica que PJN_SCRAPER_SERVICE_ROLE_KEY o SUPABASE_SERVICE_ROLE_KEY sea correcta');
        console.error('   - La service_role key debe corresponder a la base de datos de pjn-scraper');
        console.error('   - URL esperada: https://npfcgsrrhhmwywierpbf.supabase.co');
      }
      process.exit(1);
    }

    if (!casesData || casesData.length === 0) {
      console.log('⚠️  No hay casos en pjn-scraper');
      process.exit(0);
    }

    console.log(`✅ Encontrados ${casesData.length} casos\n`);

    // 2. Agrupar por número de expediente normalizado
    console.log('🔍 Identificando duplicados...');
    const expedientesMap = new Map(); // key: "047456/2020", value: array de casos

    for (const c of casesData) {
      const expText = c.key || c.expediente;
      const normalized = normalizeExpediente(expText);
      
      if (!normalized) {
        console.warn(`⚠️  No se pudo normalizar expediente: ${expText}`);
        continue;
      }

      if (!expedientesMap.has(normalized)) {
        expedientesMap.set(normalized, []);
      }
      expedientesMap.get(normalized).push(c);
    }

    // 3. Identificar duplicados (expedientes con más de un registro)
    const duplicates = [];
    for (const [expediente, casos] of expedientesMap.entries()) {
      if (casos.length > 1) {
        duplicates.push({ expediente, casos });
      }
    }

    console.log(`📊 Encontrados ${duplicates.length} expedientes con duplicados\n`);

    if (duplicates.length === 0) {
      console.log('✅ No hay duplicados. Todo está bien.');
      process.exit(0);
    }

    // 4. Para cada grupo de duplicados, decidir cuál mantener
    const toDelete = [];
    let totalDuplicates = 0;

    for (const { expediente, casos } of duplicates) {
      totalDuplicates += casos.length - 1; // Todos menos uno son duplicados
      
      // Ordenar casos para decidir cuál mantener:
      // 1. Prioridad: NO removido
      // 2. Prioridad: Más reciente (ult_act más reciente)
      // 3. Prioridad: Mayor completitud (más información)
      // 4. Prioridad: ID más reciente (created_at o updated_at)
      
      const sorted = casos.sort((a, b) => {
        // Primero: NO removido tiene prioridad
        if (a.removido !== b.removido) {
          return a.removido ? 1 : -1;
        }
        
        // Segundo: Más reciente por ult_act
        if (a.ult_act && b.ult_act) {
          const dateA = new Date(a.ult_act);
          const dateB = new Date(b.ult_act);
          if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
            const diff = dateB.getTime() - dateA.getTime();
            if (diff !== 0) return diff;
          }
        } else if (a.ult_act && !b.ult_act) return -1;
        else if (!a.ult_act && b.ult_act) return 1;
        
        // Tercero: Mayor completitud
        const scoreA = getCompletenessScore(a);
        const scoreB = getCompletenessScore(b);
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        
        // Cuarto: Key más reciente (usar key como último criterio)
        // Como no tenemos created_at/updated_at, comparar por key alfabéticamente
        const keyA = a.key || a.expediente || '';
        const keyB = b.key || b.expediente || '';
        return keyB.localeCompare(keyA);
      });

      // El primero es el que mantenemos, los demás se eliminan
      const toKeep = sorted[0];
      const toRemove = sorted.slice(1);

      console.log(`📋 Expediente ${expediente}:`);
      console.log(`   ✅ Mantener: ${toKeep.key || toKeep.expediente}`);
      console.log(`   🗑️  Eliminar: ${toRemove.length} duplicado(s)`);
      
      for (const dup of toRemove) {
        console.log(`      - ${dup.key || dup.expediente}`);
        // Usar 'key' como identificador único (la tabla cases no tiene 'id')
        toDelete.push(dup.key);
      }
    }

    console.log(`\n📊 Resumen:`);
    console.log(`   📋 Expedientes con duplicados: ${duplicates.length}`);
    console.log(`   🗑️  Registros a eliminar: ${toDelete.length}`);
    console.log(`   ✅ Registros a mantener: ${casesData.length - toDelete.length}\n`);

    // 5. Confirmar antes de eliminar
    console.log('⚠️  ADVERTENCIA: Se eliminarán los registros duplicados.');
    console.log('   Presiona Ctrl+C para cancelar, o espera 5 segundos para continuar...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 6. Eliminar duplicados en lotes
    console.log('🗑️  Eliminando duplicados...');
    const batchSize = 50;
    let deleted = 0;
    let errors = 0;

    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      
        // Eliminar por 'key' en lugar de 'id' (la tabla cases no tiene columna 'id')
        const { error: deleteErr } = await pjnSupabase
          .from("cases")
          .delete()
          .in("key", batch);

      if (deleteErr) {
        console.error(`❌ Error al eliminar lote ${Math.floor(i / batchSize) + 1}:`, deleteErr.message);
        errors += batch.length;
        
        // Intentar eliminar uno por uno para ver cuáles fallan
        for (const key of batch) {
          const { error: singleErr } = await pjnSupabase
            .from("cases")
            .delete()
            .eq("key", key);
          
          if (singleErr) {
            console.error(`   ⚠️  Error eliminando ${key}:`, singleErr.message);
          } else {
            deleted++;
            errors--;
          }
        }
      } else {
        deleted += batch.length;
        console.log(`   ✅ Lote ${Math.floor(i / batchSize) + 1}: ${batch.length} registros eliminados`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Resumen final:');
    console.log(`   ✅ Eliminados exitosamente: ${deleted} registros`);
    if (errors > 0) {
      console.log(`   ❌ Errores: ${errors} registros no se pudieron eliminar`);
    }
    console.log(`   📋 Total de registros restantes: ${casesData.length - deleted}`);
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.error('❌ Error inesperado:', error);
    process.exit(1);
  }
}

// Ejecutar
removeDuplicates()
  .then(() => {
    console.log('✅ Proceso completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
