/**
 * Script para ver y gestionar errores del scraper
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

async function viewErrors() {
  console.log('🔍 Consultando errores del scraper...\n');

  // Leer errores pendientes
  const { data: pendingErrors, error: pendingErr } = await pjnSupabase
    .from("scraper_errors")
    .select("*")
    .eq("resolved", false)
    .order("created_at", { ascending: true });

  if (pendingErr) {
    console.error('❌ Error al leer errores pendientes:', pendingErr);
    process.exit(1);
  }

  // Leer errores resueltos (últimos 20)
  const { data: resolvedErrors, error: resolvedErr } = await pjnSupabase
    .from("scraper_errors")
    .select("*")
    .eq("resolved", true)
    .order("resolved_at", { ascending: false })
    .limit(20);

  console.log('='.repeat(80));
  console.log('📊 RESUMEN DE ERRORES');
  console.log('='.repeat(80));
  console.log(`\n⚠️  Errores pendientes: ${pendingErrors?.length || 0}`);
  console.log(`✅ Errores resueltos (últimos 20): ${resolvedErrors?.length || 0}`);

  if (pendingErrors && pendingErrors.length > 0) {
    console.log(`\n📋 Errores pendientes de resolver:\n`);
    
    // Agrupar por tipo de error
    const porTipo = {};
    pendingErrors.forEach(err => {
      const tipo = err.error_type || 'unknown';
      if (!porTipo[tipo]) {
        porTipo[tipo] = [];
      }
      porTipo[tipo].push(err);
    });

    Object.entries(porTipo).forEach(([tipo, errores]) => {
      console.log(`   ${tipo}: ${errores.length} errores`);
    });

    console.log(`\n📋 Detalle de errores pendientes (primeros 30):\n`);
    pendingErrors.slice(0, 30).forEach((err, i) => {
      console.log(`${i + 1}. Página ${err.page}, Fila ${err.row} - ${err.error_type}`);
      console.log(`   Expediente: ${err.expediente_key || 'N/A'}`);
      console.log(`   Mensaje: ${err.error_message || 'N/A'}`);
      console.log(`   Reintentos: ${err.retry_count || 0}`);
      console.log(`   Creado: ${err.created_at || 'N/A'}`);
      console.log('');
    });

    if (pendingErrors.length > 30) {
      console.log(`   ... y ${pendingErrors.length - 30} más\n`);
    }

    console.log(`\n💡 Estos errores se procesarán primero en la próxima ejecución del scraper.`);
  } else {
    console.log(`\n✅ No hay errores pendientes. Todo está bien.`);
  }

  if (resolvedErrors && resolvedErrors.length > 0) {
    console.log(`\n📋 Últimos errores resueltos:\n`);
    resolvedErrors.slice(0, 10).forEach((err, i) => {
      console.log(`${i + 1}. Página ${err.page}, Fila ${err.row} - ${err.error_type} (resuelto: ${err.resolved_at})`);
    });
  }

  console.log('\n' + '='.repeat(80));
}

viewErrors()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
