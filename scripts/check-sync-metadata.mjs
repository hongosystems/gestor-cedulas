/**
 * Script para verificar y crear la tabla pjn_sync_metadata si no existe
 * 
 * Uso:
 *   node scripts/check-sync-metadata.mjs
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const mainSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const mainSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!mainSupabaseUrl || !mainSupabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno');
  console.error('   Requeridas: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const mainSupabase = createClient(mainSupabaseUrl, mainSupabaseServiceKey);

async function checkSyncMetadata() {
  console.log('🔍 Verificando tabla pjn_sync_metadata...\n');

  try {
    // Intentar leer la tabla
    const { data, error } = await mainSupabase
      .from("pjn_sync_metadata")
      .select("id, last_sync_at, created_at, updated_at")
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116' || error.message?.includes('does not exist')) {
        console.log('❌ La tabla pjn_sync_metadata NO existe.');
        console.log('\n📋 Para crear la tabla, ejecuta la migración SQL:');
        console.log('   migrations/create_pjn_sync_metadata_table.sql');
        console.log('\n   Puedes ejecutarla en el SQL Editor de Supabase.');
        process.exit(1);
      } else {
        console.error('❌ Error al leer la tabla:', error);
        process.exit(1);
      }
    }

    if (data) {
      console.log('✅ Tabla pjn_sync_metadata existe');
      console.log('\n📊 Datos actuales:');
      console.log('   ID:', data.id);
      console.log('   Última sincronización:', data.last_sync_at);
      console.log('   Creado:', data.created_at);
      console.log('   Actualizado:', data.updated_at);
      
      if (data.last_sync_at) {
        const date = new Date(data.last_sync_at);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = String(date.getFullYear()).slice(-2);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        console.log('\n📅 Formato legible:', `${day}/${month}/${year} ${hours}:${minutes}`);
      } else {
        console.log('\n⚠️  No hay fecha de sincronización guardada aún.');
      }
    } else {
      console.log('⚠️  La tabla existe pero no tiene registros.');
      console.log('   Esto es normal si nunca se ha ejecutado el cron.');
    }

    console.log('\n✅ Verificación completada.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error inesperado:', err);
    process.exit(1);
  }
}

checkSyncMetadata();
