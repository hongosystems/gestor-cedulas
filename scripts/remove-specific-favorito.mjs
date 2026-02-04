/**
 * Script para eliminar un expediente específico de pjn_favoritos
 * 
 * Uso:
 *   node scripts/remove-specific-favorito.mjs CIV 047456 2020
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!mainSupabaseUrl || !mainSupabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno');
  process.exit(1);
}

const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);

async function removeFavorito() {
  const args = process.argv.slice(2);
  const jurisdiccion = args[0] || 'CIV';
  const numero = args[1] || '047456';
  const anio = parseInt(args[2] || '2020', 10);

  console.log(`🗑️  Eliminando expediente ${jurisdiccion} ${numero}/${anio} de pjn_favoritos...\n`);

  // Buscar el expediente
  const { data: favoritos, error: searchErr } = await mainSupabase
    .from("pjn_favoritos")
    .select("id, jurisdiccion, numero, anio, caratula")
    .eq("jurisdiccion", jurisdiccion)
    .eq("numero", numero)
    .eq("anio", anio);

  if (searchErr) {
    console.error('❌ Error al buscar:', searchErr);
    process.exit(1);
  }

  if (!favoritos || favoritos.length === 0) {
    console.log('✅ El expediente no existe en pjn_favoritos');
    process.exit(0);
  }

  console.log(`📋 Encontrados ${favoritos.length} registro(s):\n`);
  favoritos.forEach((f, i) => {
    console.log(`Registro ${i + 1}:`);
    console.log(`   ID: ${f.id}`);
    console.log(`   ${f.jurisdiccion} ${f.numero}/${f.anio}`);
    console.log(`   Carátula: ${f.caratula ? f.caratula.substring(0, 60) + '...' : 'N/A'}`);
    console.log('');
  });

  // Eliminar
  const ids = favoritos.map(f => f.id);
  const { error: deleteErr } = await mainSupabase
    .from("pjn_favoritos")
    .delete()
    .in("id", ids);

  if (deleteErr) {
    console.error('❌ Error al eliminar:', deleteErr);
    process.exit(1);
  }

  console.log(`✅ ${favoritos.length} registro(s) eliminado(s) exitosamente`);
}

removeFavorito()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
