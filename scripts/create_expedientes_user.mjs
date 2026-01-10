import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Cargar .env.local explícitamente (Windows friendly)
dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en .env.local");
if (!serviceKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");

const supabase = createClient(url, serviceKey);

async function main() {
  const email = "expedientes@gmail.com";
  const password = "hola123!";
  const fullName = "Usuario Expedientes";

  console.log(`Creando usuario: ${email}...`);

  // 1. Crear usuario en Auth
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError) {
    if (authError.message.includes("already registered")) {
      console.log(`  ⚠️ Usuario ${email} ya existe. Actualizando configuración...`);
      // Si el usuario ya existe, obtener su ID
      const { data: existingUser } = await supabase.auth.admin.listUsers();
      const user = existingUser?.users?.find(u => u.email === email);
      
      if (!user) {
        console.error(`  ❌ No se pudo encontrar el usuario existente.`);
        process.exit(1);
      }
      
      var userId = user.id;
    } else {
      console.error(`  ❌ Error creando usuario: ${authError.message}`);
      process.exit(1);
    }
  } else {
    var userId = authData.user.id;
    console.log(`  ✅ Usuario creado con ID: ${userId}`);
  }

  // 2. Crear/Actualizar perfil
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        must_change_password: true, // ✅ Solicitar cambio de contraseña
      },
      { onConflict: "id" }
    );

  if (profileError) {
    console.error(`  ❌ Error creando perfil: ${profileError.message}`);
    process.exit(1);
  }
  console.log(`  ✅ Perfil creado/actualizado`);

  // 3. Crear/Actualizar rol (admin_expedientes)
  const { error: roleError } = await supabase
    .from("user_roles")
    .upsert(
      {
        user_id: userId,
        is_superadmin: false,
        is_admin_expedientes: true, // ✅ Rol Admin Expedientes
      },
      { onConflict: "user_id" }
    );

  if (roleError) {
    console.error(`  ❌ Error asignando rol: ${roleError.message}`);
    process.exit(1);
  }
  console.log(`  ✅ Rol Admin Expedientes asignado`);

  console.log("\n✅ Usuario configurado correctamente!");
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${password}`);
  console.log(`   Debe cambiar contraseña: SÍ`);
  console.log(`   Rol: Admin Expedientes`);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
