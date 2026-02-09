import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar variables de entorno
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Faltan variables de entorno');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseKey ? '✓' : '✗');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumn() {
  console.log('🔍 Verificando columna "notas" en tabla "cedulas"...\n');

  try {
    // Intentar hacer una consulta que incluya la columna notas
    const { data, error } = await supabase
      .from('cedulas')
      .select('id, notas')
      .limit(1);

    if (error) {
      if (error.message?.includes('notas') || error.message?.includes('column') || error.code === '42703') {
        console.error('❌ La columna "notas" NO existe en la tabla "cedulas"');
        console.error('   Error:', error.message);
        console.error('\n📝 Acción requerida:');
        console.error('   1. Abre Supabase SQL Editor');
        console.error('   2. Ejecuta la migración: migrations/add_notas_to_cedulas.sql');
        console.error('   3. O ejecuta manualmente:');
        console.error('      ALTER TABLE cedulas ADD COLUMN IF NOT EXISTS notas TEXT DEFAULT NULL;');
        process.exit(1);
      } else {
        console.error('❌ Error al verificar la columna:', error.message);
        process.exit(1);
      }
    } else {
      console.log('✅ La columna "notas" existe en la tabla "cedulas"');
      console.log('   Ejemplo de datos:', data?.[0] ? { id: data[0].id, notas: data[0].notas || '(null)' } : 'No hay registros');
      
      // Verificar permisos RLS
      console.log('\n🔍 Verificando permisos RLS...');
      const { data: policies, error: policiesError } = await supabase
        .rpc('exec_sql', {
          sql: `
            SELECT 
              schemaname, 
              tablename, 
              policyname, 
              permissive, 
              roles, 
              cmd
            FROM pg_policies 
            WHERE tablename = 'cedulas'
            ORDER BY cmd, policyname;
          `
        }).catch(() => ({ data: null, error: { message: 'No se pudo verificar políticas RLS (esto es normal si no tienes permisos)' } }));

      if (policiesError) {
        console.log('⚠️  No se pudieron verificar las políticas RLS (normal si no tienes permisos de administrador)');
      } else {
        console.log('✅ Políticas RLS verificadas');
      }
      
      console.log('\n✅ Todo está correcto. La columna "notas" está lista para usar.');
    }
  } catch (err) {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  }
}

checkColumn();
