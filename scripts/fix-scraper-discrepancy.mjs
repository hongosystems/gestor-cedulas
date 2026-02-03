/**
 * Script para ayudar a identificar y resolver discrepancias del scraper
 * 
 * Este script:
 * 1. Verifica el estado del scraper
 * 2. Identifica posibles causas de la discrepancia
 * 3. Sugiere acciones para resolver
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

async function analyzeDiscrepancy() {
  console.log('🔍 Analizando discrepancia del scraper...\n');

  const webTotal = 821; // Según el usuario
  const totalPages = parseInt(process.env.SCW_TOTAL_PAGES || "67", 10);

  // 1. Leer estado del scraper
  const { data: scraperState } = await pjnSupabase
    .from("scraper_state")
    .select("page, row")
    .eq("id", 1)
    .maybeSingle();

  const currentPage = scraperState?.page || 1;
  const currentRow = scraperState?.row || 0;

  // 2. Leer casos
  const { data: allCases } = await pjnSupabase
    .from("cases")
    .select("key, removido")
    .order("key", { ascending: true });

  const activeCases = allCases?.filter(c => !c.removido).length || 0;
  const diferencia = webTotal - activeCases;

  console.log('='.repeat(80));
  console.log('📊 ESTADO ACTUAL');
  console.log('='.repeat(80));
  console.log(`\n📈 Números:`);
  console.log(`   - Web del PJN: ${webTotal} favoritos`);
  console.log(`   - pjn-scraper (activos): ${activeCases}`);
  console.log(`   - Diferencia: ${diferencia > 0 ? '+' : ''}${diferencia}`);
  console.log(`\n📊 Estado del scraper:`);
  console.log(`   - Página: ${currentPage}/${totalPages}`);
  console.log(`   - Fila: ${currentRow}`);
  console.log(`   - Estado: ${currentPage > totalPages ? '✅ Completado' : '⚠️  En progreso'}`);

  if (diferencia > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🔧 PLAN DE ACCIÓN PARA RESOLVER LA DISCREPANCIA');
    console.log('='.repeat(80));
    
    console.log(`\n📋 Paso 1: Verificar configuración del scraper`);
    console.log(`   - Revisa el archivo .env del proyecto pjn-scraper`);
    console.log(`   - Verifica que SCW_TOTAL_PAGES=${totalPages} sea correcto`);
    console.log(`   - Si la web tiene más páginas, actualiza SCW_TOTAL_PAGES`);
    
    console.log(`\n📋 Paso 2: Ejecutar el scraper nuevamente`);
    console.log(`   - Ve al directorio: c:\\proyectos\\pjn-scraper`);
    console.log(`   - Ejecuta: python pw_mirror_favorites_to_supabase.py`);
    console.log(`   - El scraper procesará desde la página ${currentPage}, fila ${currentRow}`);
    console.log(`   - Si quieres reiniciar desde el principio, resetea el scraper_state:`);
    console.log(`     UPDATE scraper_state SET page = 1, row = 0 WHERE id = 1;`);
    
    console.log(`\n📋 Paso 3: Verificar logs del scraper`);
    console.log(`   - Revisa la salida del script de Python`);
    console.log(`   - Busca errores o warnings`);
    console.log(`   - Verifica archivos de debug generados (pw_*.html)`);
    
    console.log(`\n📋 Paso 4: Después de ejecutar el scraper`);
    console.log(`   - Ejecuta: npm run verify:favoritos`);
    console.log(`   - Verifica que los números coincidan`);
    console.log(`   - Si aún hay discrepancia, ejecuta: npm run sync:pjn-favoritos`);
    
    console.log(`\n💡 Notas importantes:`);
    console.log(`   - El scraper puede tardar varias horas en completarse`);
    console.log(`   - El scraper guarda el progreso, puedes detenerlo y continuar después`);
    console.log(`   - Si hay errores, el scraper los registra y continúa`);
    console.log(`   - Los favoritos removidos se marcan automáticamente como removido = true`);
    
  } else if (diferencia < 0) {
    console.log(`\n⚠️  Hay más casos en pjn-scraper que en la web.`);
    console.log(`   Esto puede ser normal si hay favoritos que fueron removidos de la web.`);
    console.log(`   Ejecuta: npm run sync:pjn-favoritos para sincronizar.`);
  } else {
    console.log(`\n✅ Los números coinciden perfectamente.`);
    console.log(`   Ejecuta: npm run sync:pjn-favoritos para sincronizar con gestor-cedulas.`);
  }

  console.log('\n' + '='.repeat(80));
}

analyzeDiscrepancy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
