/**
 * Script opcional: Limpiar archivos del bucket 'cedulas' en Supabase Storage
 * 
 * IMPORTANTE: Este script elimina TODOS los archivos del bucket 'cedulas'.
 * Ejecutar SOLO si también necesitas limpiar los archivos del storage.
 * 
 * Uso:
 *   node scripts/clear_storage_for_client.mjs
 * 
 * Requiere variables de entorno:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno');
  console.error('   Requeridas: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function clearStorage() {
  console.log('🔄 Iniciando limpieza del bucket "cedulas"...\n');

  try {
    // 1. Listar todos los archivos en el bucket
    console.log('📋 Listando archivos en el bucket...');
    const { data: files, error: listError } = await supabase.storage
      .from('cedulas')
      .list('', {
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (listError) {
      console.error('❌ Error al listar archivos:', listError.message);
      process.exit(1);
    }

    if (!files || files.length === 0) {
      console.log('✅ El bucket ya está vacío. No hay archivos para eliminar.');
      return;
    }

    console.log(`   Encontrados ${files.length} archivo(s) o carpeta(s)\n`);

    // 2. Obtener todos los paths (incluyendo subdirectorios)
    const allPaths = [];
    
    async function getAllPaths(prefix = '') {
      const { data: items, error } = await supabase.storage
        .from('cedulas')
        .list(prefix, {
          limit: 1000,
          offset: 0
        });

      if (error) {
        console.error(`❌ Error al listar en ${prefix}:`, error.message);
        return;
      }

      if (!items) return;

      for (const item of items) {
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
        
        if (item.id === null) {
          // Es una carpeta, explorar recursivamente
          await getAllPaths(fullPath);
        } else {
          // Es un archivo
          allPaths.push(fullPath);
        }
      }
    }

    await getAllPaths();

    if (allPaths.length === 0) {
      console.log('✅ No se encontraron archivos para eliminar.');
      return;
    }

    console.log(`📦 Total de archivos a eliminar: ${allPaths.length}\n`);

    // 3. Eliminar archivos en lotes (para evitar problemas con muchos archivos)
    const batchSize = 100;
    let deletedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < allPaths.length; i += batchSize) {
      const batch = allPaths.slice(i, i + batchSize);
      
      console.log(`🗑️  Eliminando lote ${Math.floor(i / batchSize) + 1} (${batch.length} archivos)...`);
      
      const { data: deleted, error: deleteError } = await supabase.storage
        .from('cedulas')
        .remove(batch);

      if (deleteError) {
        console.error(`   ⚠️  Error en lote:`, deleteError.message);
        errorCount += batch.length;
      } else {
        deletedCount += batch.length;
        console.log(`   ✅ ${batch.length} archivo(s) eliminado(s)`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Resumen:');
    console.log(`   ✅ Eliminados: ${deletedCount} archivo(s)`);
    if (errorCount > 0) {
      console.log(`   ⚠️  Errores: ${errorCount} archivo(s)`);
    }
    console.log('='.repeat(50) + '\n');

    // 4. Verificar que el bucket está vacío
    const { data: remainingFiles } = await supabase.storage
      .from('cedulas')
      .list('', { limit: 1 });

    if (remainingFiles && remainingFiles.length > 0) {
      console.log('⚠️  Advertencia: Aún quedan archivos en el bucket.');
      console.log('   Puede ser necesario ejecutar el script nuevamente o eliminar manualmente.');
    } else {
      console.log('✅ El bucket "cedulas" está completamente vacío.');
    }

  } catch (error) {
    console.error('❌ Error inesperado:', error.message);
    process.exit(1);
  }
}

// Ejecutar
clearStorage()
  .then(() => {
    console.log('\n✅ Proceso completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
