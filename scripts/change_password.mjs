/**
 * Script para cambiar la contraseña de un usuario
 * 
 * Uso:
 *   node scripts/change_password.mjs <email> <nueva_password>
 * 
 * Ejemplo:
 *   node scripts/change_password.mjs gfhisi@gmail.com hola1234
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

// Obtener argumentos de línea de comandos
const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('❌ Error: Faltan argumentos');
  console.error('');
  console.error('Uso:');
  console.error('  node scripts/change_password.mjs <email> <nueva_password>');
  console.error('');
  console.error('Ejemplo:');
  console.error('  node scripts/change_password.mjs gfhisi@gmail.com hola1234');
  process.exit(1);
}

async function changePassword() {
  console.log(`🔄 Cambiando contraseña para ${email}...\n`);

  try {
    // 1. Buscar el usuario por email
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Error al listar usuarios:', listError.message);
      process.exit(1);
    }

    const user = users.users.find(u => u.email === email);

    if (!user) {
      console.error(`❌ Error: No se encontró el usuario con email: ${email}`);
      process.exit(1);
    }

    console.log(`✅ Usuario encontrado: ${user.email} (ID: ${user.id})\n`);

    // 2. Actualizar la contraseña
    const { data, error } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: newPassword }
    );

    if (error) {
      console.error('❌ Error al cambiar la contraseña:', error.message);
      process.exit(1);
    }

    console.log('✅ Contraseña actualizada exitosamente');
    console.log(`   Email: ${data.user.email}`);
    console.log(`   Nueva contraseña: ${newPassword}`);
    console.log('');
    console.log('✅ Proceso completado.');

  } catch (error) {
    console.error('❌ Error inesperado:', error.message);
    process.exit(1);
  }
}

// Ejecutar
changePassword()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
