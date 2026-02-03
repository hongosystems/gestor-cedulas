/**
 * Script para verificar discrepancias entre:
 * 1. Favoritos en la web del PJN (según el scraper)
 * 2. Favoritos en pjn-scraper (cases con removido = false)
 * 3. Favoritos en gestor-cedulas (pjn_favoritos)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Cliente para pjn-scraper
const pjnSupabaseUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL || process.env.PJN_SCRAPER_SUPABASE_URL;
const pjnSupabaseServiceKey = process.env.PJN_SCRAPER_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente para gestor-cedulas
const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!pjnSupabaseUrl || !pjnSupabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno para pjn-scraper');
  console.error('   Configura en .env.local:');
  console.error('   - NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL');
  console.error('   - PJN_SCRAPER_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!mainSupabaseUrl || !mainSupabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno para gestor-cedulas');
  console.error('   Configura en .env.local:');
  console.error('   - NEXT_PUBLIC_SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseServiceKey);
const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);

// Función para parsear expediente y crear key normalizada
function parseExpediente(expText) {
  if (!expText) return null;
  const match = expText.match(/^([A-Z]+)\s+(\d+)\/(\d+)/);
  if (!match) return null;
  const [, jurisdiccion, numero, anioStr] = match;
  const anio = parseInt(anioStr, 10);
  if (!jurisdiccion || !numero || isNaN(anio)) return null;
  return { jurisdiccion, numero: numero.padStart(6, '0'), anio };
}

function createKey(expediente) {
  if (!expediente) return null;
  const parsed = parseExpediente(expediente.key || expediente.expediente);
  if (!parsed) return null;
  return `${parsed.jurisdiccion}|${parsed.numero}|${parsed.anio}`;
}

async function verifyDiscrepancy() {
  console.log('🔍 Verificando discrepancias entre fuentes...\n');

  // 1. Leer todos los casos de pjn-scraper (removido = false)
  console.log('📋 Leyendo casos de pjn-scraper (removido = false)...');
  const { data: casesData, error: casesErr } = await pjnSupabase
    .from("cases")
    .select("key, expediente, removido")
    .eq("removido", false);

  if (casesErr) {
    console.error('❌ Error al leer cases:', casesErr);
    process.exit(1);
  }

  console.log(`✅ Encontrados ${casesData?.length || 0} casos en pjn-scraper (removido = false)\n`);

  // 2. Leer todos los favoritos de gestor-cedulas
  console.log('📋 Leyendo favoritos de gestor-cedulas (pjn_favoritos)...');
  const { data: favoritosData, error: favoritosErr } = await mainSupabase
    .from("pjn_favoritos")
    .select("id, jurisdiccion, numero, anio");

  if (favoritosErr) {
    console.error('❌ Error al leer pjn_favoritos:', favoritosErr);
    process.exit(1);
  }

  console.log(`✅ Encontrados ${favoritosData?.length || 0} favoritos en gestor-cedulas\n`);

  // 3. Crear sets de keys normalizadas
  const casesKeys = new Set();
  const favoritosKeys = new Set();

  if (casesData) {
    casesData.forEach(c => {
      const key = createKey(c);
      if (key) casesKeys.add(key);
    });
  }

  if (favoritosData) {
    favoritosData.forEach(f => {
      const numeroNormalizado = String(f.numero).padStart(6, '0');
      const key = `${f.jurisdiccion}|${numeroNormalizado}|${f.anio}`;
      favoritosKeys.add(key);
    });
  }

  // 4. Encontrar discrepancias
  const enCasesNoEnFavoritos = [];
  const enFavoritosNoEnCases = [];

  casesData?.forEach(c => {
    const key = createKey(c);
    if (key && !favoritosKeys.has(key)) {
      enCasesNoEnFavoritos.push({
        key: c.key || c.expediente,
        parsed: key
      });
    }
  });

  favoritosData?.forEach(f => {
    const numeroNormalizado = String(f.numero).padStart(6, '0');
    const key = `${f.jurisdiccion}|${numeroNormalizado}|${f.anio}`;
    if (!casesKeys.has(key)) {
      enFavoritosNoEnCases.push({
        id: f.id,
        jurisdiccion: f.jurisdiccion,
        numero: f.numero,
        anio: f.anio,
        parsed: key
      });
    }
  });

  // 5. Verificar casos removidos que aún están en favoritos
  console.log('📋 Verificando casos removidos en pjn-scraper...');
  const { data: removedCases, error: removedErr } = await pjnSupabase
    .from("cases")
    .select("key, expediente, removido")
    .eq("removido", true);

  if (removedErr) {
    console.error('❌ Error al leer casos removidos:', removedErr);
  } else {
    console.log(`✅ Encontrados ${removedCases?.length || 0} casos removidos en pjn-scraper\n`);
  }

  const removedKeys = new Set();
  removedCases?.forEach(c => {
    const key = createKey(c);
    if (key) removedKeys.add(key);
  });

  const removidosEnFavoritos = [];
  favoritosData?.forEach(f => {
    const numeroNormalizado = String(f.numero).padStart(6, '0');
    const key = `${f.jurisdiccion}|${numeroNormalizado}|${f.anio}`;
    if (removedKeys.has(key)) {
      removidosEnFavoritos.push({
        id: f.id,
        jurisdiccion: f.jurisdiccion,
        numero: f.numero,
        anio: f.anio,
        key: `${f.jurisdiccion} ${f.numero}/${f.anio}`
      });
    }
  });

  // 6. Mostrar resumen
  console.log('='.repeat(80));
  console.log('📊 RESUMEN DE VERIFICACIÓN');
  console.log('='.repeat(80));
  console.log(`\n📈 Totales:`);
  console.log(`   - pjn-scraper (removido = false): ${casesData?.length || 0}`);
  console.log(`   - gestor-cedulas (pjn_favoritos): ${favoritosData?.length || 0}`);
  console.log(`   - pjn-scraper (removido = true): ${removedCases?.length || 0}`);
  console.log(`   - Web del PJN (según usuario): 821`);

  console.log(`\n🔍 Discrepancias:`);
  console.log(`   - En pjn-scraper pero NO en gestor-cedulas: ${enCasesNoEnFavoritos.length}`);
  console.log(`   - En gestor-cedulas pero NO en pjn-scraper: ${enFavoritosNoEnCases.length}`);
  console.log(`   - Removidos en pjn-scraper pero aún en gestor-cedulas: ${removidosEnFavoritos.length}`);

  // 7. Mostrar detalles
  if (enCasesNoEnFavoritos.length > 0) {
    console.log(`\n📋 Expedientes en pjn-scraper pero NO en gestor-cedulas (primeros 20):`);
    enCasesNoEnFavoritos.slice(0, 20).forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.key}`);
    });
    if (enCasesNoEnFavoritos.length > 20) {
      console.log(`   ... y ${enCasesNoEnFavoritos.length - 20} más`);
    }
  }

  if (enFavoritosNoEnCases.length > 0) {
    console.log(`\n📋 Expedientes en gestor-cedulas pero NO en pjn-scraper (primeros 20):`);
    enFavoritosNoEnCases.slice(0, 20).forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.jurisdiccion} ${item.numero}/${item.anio}`);
    });
    if (enFavoritosNoEnCases.length > 20) {
      console.log(`   ... y ${enFavoritosNoEnCases.length - 20} más`);
    }
  }

  if (removidosEnFavoritos.length > 0) {
    console.log(`\n⚠️  Expedientes REMOVIDOS en pjn-scraper pero aún en gestor-cedulas (primeros 20):`);
    removidosEnFavoritos.slice(0, 20).forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.key} (ID: ${item.id})`);
    });
    if (removidosEnFavoritos.length > 20) {
      console.log(`   ... y ${removidosEnFavoritos.length - 20} más`);
    }
    console.log(`\n💡 Estos deberían eliminarse ejecutando: npm run sync:pjn-favoritos`);
  }

  // 8. Análisis de la discrepancia con la web
  const diferenciaWeb = 821 - (casesData?.length || 0);
  console.log(`\n🌐 Comparación con Web del PJN:`);
  console.log(`   - Web del PJN: 821 favoritos`);
  console.log(`   - pjn-scraper (removido = false): ${casesData?.length || 0}`);
  console.log(`   - Diferencia: ${diferenciaWeb > 0 ? '+' : ''}${diferenciaWeb}`);
  
  if (diferenciaWeb > 0) {
    console.log(`\n⚠️  Hay ${diferenciaWeb} favoritos en la web que NO están en pjn-scraper.`);
    console.log(`   Posibles causas:`);
    console.log(`   1. El scraper no ha procesado todas las páginas`);
    console.log(`   2. Hay favoritos nuevos que aún no se han scrapeado`);
    console.log(`   3. El scraper falló en algunas páginas/filas`);
    console.log(`\n💡 Verifica el estado del scraper ejecutando el script de Python`);
  } else if (diferenciaWeb < 0) {
    console.log(`\n⚠️  Hay ${Math.abs(diferenciaWeb)} favoritos más en pjn-scraper que en la web.`);
    console.log(`   Posibles causas:`);
    console.log(`   1. Favoritos fueron removidos de la web pero aún no se marcaron como removido`);
    console.log(`   2. El scraper necesita ejecutarse para actualizar el estado`);
  }

  // 9. Verificar estado del scraper
  console.log(`\n📊 Verificando estado del scraper...`);
  try {
    const { data: scraperState, error: stateErr } = await pjnSupabase
      .from("scraper_state")
      .select("page, row")
      .eq("id", 1)
      .maybeSingle();

    if (stateErr) {
      console.log(`   ⚠️  No se pudo leer scraper_state: ${stateErr.message}`);
    } else if (scraperState) {
      const totalPages = parseInt(process.env.SCW_TOTAL_PAGES || "67", 10);
      const currentPage = scraperState.page || 1;
      const currentRow = scraperState.row || 0;
      
      console.log(`   - Página actual: ${currentPage}/${totalPages}`);
      console.log(`   - Fila actual: ${currentRow}`);
      
      if (currentPage > totalPages) {
        console.log(`   ✅ Scraper completado (página ${currentPage} > ${totalPages})`);
      } else {
        console.log(`   ⚠️  Scraper en progreso o detenido`);
        console.log(`   💡 Ejecuta el script de Python para continuar/completar`);
      }
    } else {
      console.log(`   ⚠️  No hay estado del scraper (primera ejecución)`);
    }
  } catch (error) {
    console.log(`   ⚠️  Error al verificar estado: ${error.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Verificación completada');
  console.log('='.repeat(80));
}

verifyDiscrepancy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
