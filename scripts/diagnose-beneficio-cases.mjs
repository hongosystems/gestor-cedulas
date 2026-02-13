/**
 * Script de diagnóstico para casos "BENEFICIO DE LITIGAR SIN GASTOS"
 * 
 * Uso:
 *   node scripts/diagnose-beneficio-cases.mjs
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Cliente para base de datos pjn-scraper
const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const pjnSupabaseAnonKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!pjnSupabaseUrl || !pjnSupabaseAnonKey) {
  console.error('❌ Error: Faltan variables de entorno de pjn-scraper');
  process.exit(1);
}

const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseAnonKey);

// Función para parsear expediente (igual que en sync-pjn-favoritos.mjs)
function parseExpediente(expText) {
  if (!expText) return null;
  
  // Primero intentar match al inicio (para compatibilidad con formato estándar)
  let match = expText.match(/^([A-Z]+)\s+(\d+)\/(\d+)/);
  
  // Si no hay match al inicio, buscar en cualquier parte del texto
  if (!match) {
    match = expText.match(/\b([A-Z]+)\s+(\d+)\/(\d+)\b/);
  }
  
  if (!match) return null;
  
  const [, jurisdiccion, numero, anioStr] = match;
  const anio = parseInt(anioStr, 10);
  
  if (!jurisdiccion || !numero || isNaN(anio)) return null;
  
  return { jurisdiccion, numero, anio };
}

async function diagnoseBeneficioCases() {
  console.log('🔍 Buscando casos con "BENEFICIO DE LITIGAR SIN GASTOS"...\n');

  try {
    // Buscar todos los casos con "BENEFICIO DE LITIGAR SIN GASTOS" en la carátula
    const { data: casesData, error: casesErr } = await pjnSupabase
      .from("cases")
      .select("key, expediente, caratula, dependencia, ult_act, removido")
      .ilike("caratula", "%BENEFICIO DE LITIGAR SIN GASTOS%");

    if (casesErr) {
      console.error('❌ Error al leer cases:', casesErr);
      process.exit(1);
    }

    if (!casesData || casesData.length === 0) {
      console.log('⚠️  No se encontraron casos con "BENEFICIO DE LITIGAR SIN GASTOS"');
      process.exit(0);
    }

    console.log(`✅ Encontrados ${casesData.length} casos con "BENEFICIO DE LITIGAR SIN GASTOS"\n`);
    console.log('='.repeat(80));

    let parsedCount = 0;
    let notParsedCount = 0;
    let removedCount = 0;
    let wouldSyncCount = 0;

    for (const c of casesData) {
      const expText = c.key || c.expediente;
      const parsed = parseExpediente(expText);
      const hasBeneficio = c.caratula && c.caratula.toUpperCase().includes("BENEFICIO DE LITIGAR SIN GASTOS");
      
      console.log('\n📋 Caso:');
      console.log(`   Key: "${c.key || '(null)'}"`);
      console.log(`   Expediente: "${c.expediente || '(null)'}"`);
      console.log(`   Carátula: ${c.caratula?.substring(0, 100) || '(null)'}...`);
      console.log(`   Removido: ${c.removido}`);
      console.log(`   Dependencia: ${c.dependencia || '(null)'}`);
      
      if (parsed) {
        parsedCount++;
        console.log(`   ✅ PARSEADO: ${parsed.jurisdiccion} ${parsed.numero}/${parsed.anio}`);
        
        if (c.removido === true) {
          removedCount++;
          console.log(`   ⚠️  NO SE SINCRONIZARÁ (marcado como removido)`);
        } else {
          wouldSyncCount++;
          console.log(`   ✅ SE SINCRONIZARÍA`);
        }
      } else {
        notParsedCount++;
        console.log(`   ❌ NO PARSEADO`);
        console.log(`   ⚠️  NO SE SINCRONIZARÁ (no se puede parsear el expediente)`);
      }
      
      console.log('-'.repeat(80));
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 Resumen:');
    console.log(`   Total casos encontrados: ${casesData.length}`);
    console.log(`   ✅ Parseados correctamente: ${parsedCount}`);
    console.log(`   ❌ No parseados: ${notParsedCount}`);
    console.log(`   🚫 Marcados como removido: ${removedCount}`);
    console.log(`   ✅ Se sincronizarían: ${wouldSyncCount}`);
    console.log('='.repeat(80) + '\n');

    // Mostrar ejemplos de casos no parseados
    if (notParsedCount > 0) {
      console.log('🔍 Ejemplos de casos NO parseados:');
      const notParsed = casesData.filter(c => !parseExpediente(c.key || c.expediente));
      for (let i = 0; i < Math.min(5, notParsed.length); i++) {
        const c = notParsed[i];
        console.log(`\n   ${i + 1}. Key: "${c.key || '(null)'}"`);
        console.log(`      Expediente: "${c.expediente || '(null)'}"`);
      }
    }

  } catch (error) {
    console.error('❌ Error inesperado:', error);
    process.exit(1);
  }
}

// Ejecutar
diagnoseBeneficioCases()
  .then(() => {
    console.log('✅ Diagnóstico completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
