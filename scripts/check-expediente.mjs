/**
 * Script para verificar un expediente específico en pjn-scraper
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
  console.error('❌ Error: Faltan variables de entorno');
  process.exit(1);
}

const pjnSupabase = createClient(pjnSupabaseUrl, pjnSupabaseServiceKey);

async function checkExpediente() {
  const numero = '047456';
  const anio = 2020;
  
  console.log(`🔍 Buscando expediente ${numero}/${anio} en pjn-scraper...\n`);
  
  // Buscar por número (con y sin ceros a la izquierda)
  const { data: cases1, error: err1 } = await pjnSupabase
    .from("cases")
    .select("key, expediente, caratula, dependencia, ult_act, removido")
    .ilike("key", `%${numero}/${anio}%`);
  
  const { data: cases2, error: err2 } = await pjnSupabase
    .from("cases")
    .select("key, expediente, caratula, dependencia, ult_act, removido")
    .ilike("key", `%47456/${anio}%`);
  
  const { data: cases3, error: err3 } = await pjnSupabase
    .from("cases")
    .select("key, expediente, caratula, dependencia, ult_act, removido")
    .ilike("expediente", `%${numero}/${anio}%`);
  
  const allCases = [
    ...(cases1 || []),
    ...(cases2 || []),
    ...(cases3 || [])
  ];
  
  // Eliminar duplicados
  const uniqueCases = Array.from(new Map(allCases.map(c => [c.key, c])).values());
  
  console.log(`📊 Encontrados ${uniqueCases.length} caso(s):\n`);
  
  if (uniqueCases.length === 0) {
    console.log('❌ No se encontró ningún caso con ese número');
    console.log('\n💡 Esto significa que el caso fue eliminado completamente de cases.');
    console.log('   El expediente debería eliminarse de pjn_favoritos porque ya no existe en cases.');
  } else {
    uniqueCases.forEach((c, i) => {
      console.log(`Caso ${i + 1}:`);
      console.log(`   Key: ${c.key || c.expediente}`);
      console.log(`   Removido: ${c.removido === true ? '✅ SÍ' : '❌ NO'}`);
      console.log(`   Carátula: ${c.caratula ? c.caratula.substring(0, 50) + '...' : 'N/A'}`);
      console.log(`   Última act: ${c.ult_act || 'N/A'}`);
      console.log('');
    });
  }
  
  // Verificar en pjn_favoritos
  const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (mainSupabaseUrl && mainSupabaseServiceKey) {
    const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);
    
    console.log(`🔍 Verificando en pjn_favoritos...\n`);
    
    const { data: favoritos, error: favErr } = await mainSupabase
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, caratula")
      .eq("numero", numero)
      .eq("anio", anio);
    
    if (favErr) {
      console.error('❌ Error al leer pjn_favoritos:', favErr);
    } else if (favoritos && favoritos.length > 0) {
      console.log(`📊 Encontrados ${favoritos.length} registro(s) en pjn_favoritos:\n`);
      favoritos.forEach((f, i) => {
        console.log(`Registro ${i + 1}:`);
        console.log(`   ID: ${f.id}`);
        console.log(`   Jurisdicción: ${f.jurisdiccion}`);
        console.log(`   Número: ${f.numero}`);
        console.log(`   Año: ${f.anio}`);
        console.log(`   Carátula: ${f.caratula ? f.caratula.substring(0, 50) + '...' : 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('✅ No se encontró en pjn_favoritos (ya fue eliminado)');
    }
  }
}

checkExpediente()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
