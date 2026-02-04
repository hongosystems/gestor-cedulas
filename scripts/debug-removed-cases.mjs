/**
 * Script para debuggear casos removidos y verificar si están en pjn_favoritos
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
const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!pjnSupabaseUrl || !pjnSupabaseServiceKey || !mainSupabaseUrl || !mainSupabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno');
  process.exit(1);
}

const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseServiceKey);
const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);

function parseExpediente(expText) {
  if (!expText) return null;
  const match = expText.match(/^([A-Z]+)\s+(\d+)\/(\d+)/);
  if (!match) return null;
  const [, jurisdiccion, numero, anioStr] = match;
  const anio = parseInt(anioStr, 10);
  if (!jurisdiccion || !numero || isNaN(anio)) return null;
  return { jurisdiccion, numero, anio };
}

async function debugRemoved() {
  console.log('🔍 Analizando casos removidos...\n');

  // 1. Leer casos removidos de pjn-scraper
  const { data: casesData, error: casesErr } = await pjnSupabase
    .from("cases")
    .select("key, expediente, removido")
    .eq("removido", true)
    .limit(20); // Primeros 20 para debug

  if (casesErr) {
    console.error('❌ Error:', casesErr);
    process.exit(1);
  }

  console.log(`📋 Encontrados ${casesData?.length || 0} casos removidos (mostrando primeros 20)\n`);

  if (!casesData || casesData.length === 0) {
    console.log('✅ No hay casos removidos');
    process.exit(0);
  }

  // 2. Parsear y crear keys normalizadas
  const removedKeys = new Set();
  const removedKeysNormalized = new Set();

  for (const c of casesData) {
    const parsed = parseExpediente(c.key || c.expediente);
    if (!parsed) continue;

    const key = `${parsed.jurisdiccion}|${parsed.numero}|${parsed.anio}`;
    const numeroNormalizado = parsed.numero.padStart(6, '0');
    const keyNormalized = `${parsed.jurisdiccion}|${numeroNormalizado}|${parsed.anio}`;
    const numeroSinCeros = parsed.numero.replace(/^0+/, '');
    const keySinCeros = `${parsed.jurisdiccion}|${numeroSinCeros}|${parsed.anio}`;

    removedKeys.add(key);
    removedKeysNormalized.add(keyNormalized);
    removedKeysNormalized.add(keySinCeros);
  }

  console.log(`📊 Keys generadas: ${removedKeys.size} (sin normalizar), ${removedKeysNormalized.size} (normalizadas)\n`);

  // 3. Leer todos los favoritos
  const { data: favoritos, error: favErr } = await mainSupabase
    .from("pjn_favoritos")
    .select("id, jurisdiccion, numero, anio");

  if (favErr) {
    console.error('❌ Error al leer favoritos:', favErr);
    process.exit(1);
  }

  console.log(`📋 Total de favoritos en pjn_favoritos: ${favoritos?.length || 0}\n`);

  // 4. Buscar coincidencias
  const matches = [];
  if (favoritos) {
    for (const fav of favoritos) {
      const numeroNormalizado = String(fav.numero).padStart(6, '0');
      const key = `${fav.jurisdiccion}|${numeroNormalizado}|${fav.anio}`;
      const keyOriginal = `${fav.jurisdiccion}|${fav.numero}|${fav.anio}`;
      const numeroSinCeros = String(fav.numero).replace(/^0+/, '');
      const keySinCeros = `${fav.jurisdiccion}|${numeroSinCeros}|${fav.anio}`;

      const isMatch = removedKeys.has(key) || removedKeys.has(keyOriginal) || removedKeys.has(keySinCeros) ||
                      removedKeysNormalized.has(key) || removedKeysNormalized.has(keyOriginal) || removedKeysNormalized.has(keySinCeros);

      if (isMatch) {
        matches.push({
          favorito: fav,
          keys: { key, keyOriginal, keySinCeros }
        });
      }
    }
  }

  console.log(`🔍 Coincidencias encontradas: ${matches.length}\n`);

  if (matches.length > 0) {
    console.log('📋 Expedientes que deberían eliminarse:\n');
    matches.slice(0, 10).forEach((m, i) => {
      console.log(`${i + 1}. ${m.favorito.jurisdiccion} ${m.favorito.numero}/${m.favorito.anio}`);
      console.log(`   Keys: ${m.keys.key}, ${m.keys.keyOriginal}, ${m.keys.keySinCeros}`);
      console.log('');
    });
    if (matches.length > 10) {
      console.log(`   ... y ${matches.length - 10} más\n`);
    }
  } else {
    console.log('✅ No se encontraron coincidencias. Los expedientes removidos ya no están en pjn_favoritos.\n');
    
    // Mostrar algunos ejemplos de casos removidos
    console.log('📋 Ejemplos de casos removidos en pjn-scraper:\n');
    casesData.slice(0, 5).forEach((c, i) => {
      const parsed = parseExpediente(c.key || c.expediente);
      if (parsed) {
        console.log(`${i + 1}. ${parsed.jurisdiccion} ${parsed.numero}/${parsed.anio}`);
        console.log(`   Key: ${c.key || c.expediente}`);
        console.log('');
      }
    });
  }
}

debugRemoved()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
