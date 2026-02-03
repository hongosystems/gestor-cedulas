/**
 * Script para analizar la completitud del scraper
 * Compara el estado del scraper con los casos en la base de datos
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL || process.env.PJN_SCRAPER_SUPABASE_URL;
const pjnSupabaseServiceKey = process.env.PJN_SCRAPER_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!pjnSupabaseUrl || !pjnSupabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno para pjn-scraper');
  process.exit(1);
}

const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseServiceKey);

async function analyzeScraper() {
  console.log('🔍 Analizando completitud del scraper...\n');

  // 1. Leer estado del scraper
  console.log('📊 Leyendo estado del scraper...');
  const { data: scraperState, error: stateErr } = await pjnSupabase
    .from("scraper_state")
    .select("page, row")
    .eq("id", 1)
    .maybeSingle();

  if (stateErr) {
    console.error('❌ Error al leer scraper_state:', stateErr);
    process.exit(1);
  }

  const totalPages = parseInt(process.env.SCW_TOTAL_PAGES || "67", 10);
  const currentPage = scraperState?.page || 1;
  const currentRow = scraperState?.row || 0;

  console.log(`   - Página actual: ${currentPage}/${totalPages}`);
  console.log(`   - Fila actual: ${currentRow}`);
  console.log(`   - Estado: ${currentPage > totalPages ? '✅ Completado' : '⚠️  En progreso'}\n`);

  // 2. Leer todos los casos
  console.log('📋 Leyendo todos los casos de pjn-scraper...');
  const { data: allCases, error: allCasesErr } = await pjnSupabase
    .from("cases")
    .select("key, expediente, removido, ult_act, dependencia")
    .order("key", { ascending: true });

  if (allCasesErr) {
    console.error('❌ Error al leer cases:', allCasesErr);
    process.exit(1);
  }

  const totalCases = allCases?.length || 0;
  const activeCases = allCases?.filter(c => !c.removido).length || 0;
  const removedCases = allCases?.filter(c => c.removido).length || 0;

  console.log(`   - Total casos: ${totalCases}`);
  console.log(`   - Casos activos (removido = false): ${activeCases}`);
  console.log(`   - Casos removidos (removido = true): ${removedCases}\n`);

  // 3. Analizar por dependencia/juzgado
  console.log('📊 Analizando casos por dependencia...');
  const casosPorDependencia = {};
  allCases?.forEach(c => {
    const dep = c.dependencia || 'SIN DEPENDENCIA';
    if (!casosPorDependencia[dep]) {
      casosPorDependencia[dep] = { total: 0, activos: 0, removidos: 0 };
    }
    casosPorDependencia[dep].total++;
    if (c.removido) {
      casosPorDependencia[dep].removidos++;
    } else {
      casosPorDependencia[dep].activos++;
    }
  });

  const dependenciasOrdenadas = Object.entries(casosPorDependencia)
    .sort((a, b) => b[1].activos - a[1].activos)
    .slice(0, 10);

  console.log(`   Top 10 dependencias por casos activos:`);
  dependenciasOrdenadas.forEach(([dep, stats], i) => {
    console.log(`   ${i + 1}. ${dep.substring(0, 60)}: ${stats.activos} activos, ${stats.removidos} removidos`);
  });

  // 4. Verificar casos con ult_act reciente vs antiguos
  console.log(`\n📅 Analizando fechas de última actividad...`);
  const casosConFecha = allCases?.filter(c => c.ult_act && c.ult_act.trim()).length || 0;
  const casosSinFecha = totalCases - casosConFecha;
  console.log(`   - Casos con fecha ult_act: ${casosConFecha}`);
  console.log(`   - Casos sin fecha ult_act: ${casosSinFecha}`);

  // 5. Verificar duplicados por key
  console.log(`\n🔍 Verificando duplicados...`);
  const keys = new Map();
  const duplicados = [];
  
  allCases?.forEach(c => {
    const key = c.key || c.expediente;
    if (key) {
      if (keys.has(key)) {
        duplicados.push(key);
      } else {
        keys.set(key, c);
      }
    }
  });

  if (duplicados.length > 0) {
    console.log(`   ⚠️  Encontrados ${duplicados.length} keys duplicados:`);
    duplicados.slice(0, 10).forEach((key, i) => {
      console.log(`   ${i + 1}. ${key}`);
    });
    if (duplicados.length > 10) {
      console.log(`   ... y ${duplicados.length - 10} más`);
    }
  } else {
    console.log(`   ✅ No hay duplicados por key`);
  }

  // 6. Comparación con web del PJN
  const webTotal = 821;
  const diferencia = webTotal - activeCases;
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 RESUMEN DE ANÁLISIS');
  console.log('='.repeat(80));
  console.log(`\n📈 Totales:`);
  console.log(`   - Web del PJN: ${webTotal} favoritos`);
  console.log(`   - pjn-scraper (activos): ${activeCases}`);
  console.log(`   - Diferencia: ${diferencia > 0 ? '+' : ''}${diferencia}`);
  
  if (diferencia > 0) {
    console.log(`\n⚠️  Hay ${diferencia} favoritos en la web que NO están en pjn-scraper.`);
    console.log(`\n💡 Posibles causas y soluciones:`);
    console.log(`   1. El scraper no procesó todas las páginas correctamente`);
    console.log(`      → Verifica los logs del scraper para errores`);
    console.log(`      → Ejecuta el script de Python nuevamente`);
    console.log(`\n   2. Hay favoritos nuevos que se agregaron después de la última ejecución`);
    console.log(`      → Ejecuta el script de Python para actualizar`);
    console.log(`\n   3. El scraper falló silenciosamente en algunas filas`);
    console.log(`      → Revisa los archivos de debug generados (pw_*.html)`);
    console.log(`      → Verifica el estado del scraper (página/fila)`);
    console.log(`\n   4. El conteo de la web puede incluir favoritos que fueron removidos`);
    console.log(`      → Verifica si hay favoritos marcados como removido que deberían estar activos`);
  } else if (diferencia < 0) {
    console.log(`\n⚠️  Hay ${Math.abs(diferencia)} favoritos más en pjn-scraper que en la web.`);
    console.log(`   Esto puede indicar que hay favoritos que fueron removidos de la web.`);
    console.log(`   Verifica si los casos removidos corresponden a favoritos eliminados.`);
  } else {
    console.log(`\n✅ Los números coinciden perfectamente.`);
  }

  // 7. Recomendaciones
  console.log(`\n💡 Recomendaciones:`);
  if (currentPage <= totalPages) {
    console.log(`   - El scraper no está completado. Ejecuta el script de Python para continuar.`);
  } else if (diferencia > 0) {
    console.log(`   - Ejecuta el script de Python para actualizar los favoritos faltantes.`);
    console.log(`   - Verifica si SCW_TOTAL_PAGES está actualizado (actual: ${totalPages})`);
  } else {
    console.log(`   - Ejecuta la sincronización: npm run sync:pjn-favoritos`);
  }

  console.log('\n' + '='.repeat(80));
}

analyzeScraper()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
