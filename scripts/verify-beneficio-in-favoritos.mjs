/**
 * Script para verificar si los casos "BENEFICIO DE LITIGAR SIN GASTOS" 
 * que deberían sincronizarse están en pjn_favoritos
 * 
 * Uso:
 *   node scripts/verify-beneficio-in-favoritos.mjs
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

// Función para parsear expediente (igual que en sync-pjn-favoritos.mjs)
function parseExpediente(expText) {
  if (!expText) return null;
  
  let match = expText.match(/^([A-Z]+)\s+(\d+)\/(\d+)/);
  
  if (!match) {
    match = expText.match(/\b([A-Z]+)\s+(\d+)\/(\d+)\b/);
  }
  
  if (!match) return null;
  
  const [, jurisdiccion, numero, anioStr] = match;
  const anio = parseInt(anioStr, 10);
  
  if (!jurisdiccion || !numero || isNaN(anio)) return null;
  
  return { jurisdiccion, numero, anio };
}

async function verifyBeneficioInFavoritos() {
  console.log('🔍 Verificando casos "BENEFICIO DE LITIGAR SIN GASTOS" en pjn_favoritos...\n');

  try {
    // 1. Obtener casos con BENEFICIO que deberían sincronizarse (removido = false)
    const { data: casesData, error: casesErr } = await pjnSupabase
      .from("cases")
      .select("key, expediente, caratula, dependencia, removido")
      .ilike("caratula", "%BENEFICIO DE LITIGAR SIN GASTOS%")
      .eq("removido", false);

    if (casesErr) {
      console.error('❌ Error al leer cases:', casesErr);
      process.exit(1);
    }

    if (!casesData || casesData.length === 0) {
      console.log('⚠️  No se encontraron casos con "BENEFICIO DE LITIGAR SIN GASTOS" que deberían sincronizarse');
      process.exit(0);
    }

    console.log(`✅ Encontrados ${casesData.length} casos que deberían sincronizarse\n`);

    // 2. Parsear y crear lista de expedientes únicos
    const expedientesEsperados = new Map(); // key: "jurisdiccion|numero|anio" -> caso

    for (const c of casesData) {
      const expText = c.key || c.expediente;
      const parsed = parseExpediente(expText);
      
      if (parsed) {
        const numeroNormalizado = parsed.numero.padStart(6, '0');
        const key = `${parsed.jurisdiccion}|${numeroNormalizado}|${parsed.anio}`;
        
        // Si ya existe, mantener el primero (o el que tenga mejor formato)
        if (!expedientesEsperados.has(key)) {
          expedientesEsperados.set(key, {
            jurisdiccion: parsed.jurisdiccion,
            numero: parsed.numero,
            anio: parsed.anio,
            caratula: c.caratula,
            key: c.key,
            expediente: c.expediente
          });
        }
      }
    }

    console.log(`📋 Expedientes únicos esperados: ${expedientesEsperados.size}\n`);

    // 3. Buscar en pjn_favoritos
    const { data: favoritosData, error: favoritosErr } = await mainSupabase
      .from("pjn_favoritos")
      .select("jurisdiccion, numero, anio, caratula");

    if (favoritosErr) {
      console.error('❌ Error al leer pjn_favoritos:', favoritosErr);
      process.exit(1);
    }

    // 4. Crear mapa de favoritos
    const favoritosMap = new Map();
    if (favoritosData) {
      for (const fav of favoritosData) {
        const numeroNormalizado = String(fav.numero).padStart(6, '0');
        const key = `${fav.jurisdiccion}|${numeroNormalizado}|${fav.anio}`;
        favoritosMap.set(key, fav);
      }
    }

    // 5. Comparar
    console.log('='.repeat(80));
    let encontrados = 0;
    let noEncontrados = 0;

    for (const [key, esperado] of expedientesEsperados) {
      const encontrado = favoritosMap.has(key);
      
      if (encontrado) {
        encontrados++;
        const favorito = favoritosMap.get(key);
        const tieneBeneficio = favorito.caratula && favorito.caratula.toUpperCase().includes("BENEFICIO DE LITIGAR SIN GASTOS");
        
        if (tieneBeneficio) {
          console.log(`✅ ${esperado.jurisdiccion} ${esperado.numero}/${esperado.anio} - ENCONTRADO con BENEFICIO`);
        } else {
          console.log(`⚠️  ${esperado.jurisdiccion} ${esperado.numero}/${esperado.anio} - ENCONTRADO pero SIN "BENEFICIO" en carátula`);
        }
      } else {
        noEncontrados++;
        console.log(`❌ ${esperado.jurisdiccion} ${esperado.numero}/${esperado.anio} - NO ENCONTRADO`);
        console.log(`   Key original: "${esperado.key}"`);
        console.log(`   Expediente: "${esperado.expediente}"`);
        console.log(`   Carátula: ${esperado.caratula?.substring(0, 80)}...`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 Resumen:');
    console.log(`   Total expedientes esperados: ${expedientesEsperados.size}`);
    console.log(`   ✅ Encontrados en pjn_favoritos: ${encontrados}`);
    console.log(`   ❌ No encontrados: ${noEncontrados}`);
    console.log('='.repeat(80) + '\n');

    // 6. Buscar casos con BENEFICIO en pjn_favoritos que no están en cases
    if (favoritosData) {
      const favoritosConBeneficio = favoritosData.filter(fav => 
        fav.caratula && fav.caratula.toUpperCase().includes("BENEFICIO DE LITIGAR SIN GASTOS")
      );
      
      console.log(`\n📋 Casos con "BENEFICIO DE LITIGAR SIN GASTOS" en pjn_favoritos: ${favoritosConBeneficio.length}`);
      
      if (favoritosConBeneficio.length > 0) {
        console.log('\nEjemplos:');
        for (let i = 0; i < Math.min(5, favoritosConBeneficio.length); i++) {
          const fav = favoritosConBeneficio[i];
          console.log(`   ${fav.jurisdiccion} ${fav.numero}/${fav.anio}`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error inesperado:', error);
    process.exit(1);
  }
}

// Ejecutar
verifyBeneficioInFavoritos()
  .then(() => {
    console.log('✅ Verificación completada.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
