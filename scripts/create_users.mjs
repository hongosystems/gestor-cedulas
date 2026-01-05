import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Cargar .env.local explícitamente (Windows friendly)
dotenv.config({ path: ".env.local" });


const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en .env.local");
if (!serviceKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");

const supabase = createClient(url, serviceKey);

/**
 * 👉 COMPLETÁ ACÁ TU LISTA REAL
 * role: "admin" | "superadmin"
 *
 * IMPORTANTE:
 * - admins: password hola123
 * - superadmin: Contraseña1995!
 */
const users = [
  { email: "gfhisi@gmail.com", full_name: "Gustavo Hisi", role: "superadmin" },
  { email: "andreaestudio24@gmail.com", full_name: "Andrea Villan", role: "admin" },
  { email: "micaelaestudio01@gmail.com", full_name: "Micaela Heinrich", role: "admin" },
  { email: "autorizadosestudiohif@gmail.com", full_name: "Gabriel Crespo", role: "admin" },
  { email: "mf.magaliflores@gmail.com", full_name: "Magali Flores", role: "admin" },
  { email: "novedadesgh@outlook.com", full_name: "Francisco Querinuzzi", role: "admin" },
  { email: "victoria.estudiohisi@gmail.com", full_name: "Guido Querinuzzi", role: "admin" },
  { email: "ifran_jorge@hotmail.com", full_name: "Jorge Alejandro Ifran", role: "superadmin" },
  { email: "maggiecollado@gmail.com", full_name: "Maggie Collado", role: "admin" },
];

function initialPassword(role) {
  return role === "superadmin" ? "Contraseña1995!" : "hola123";
}

async function upsertRole(userId, role) {
  // tabla user_roles debe existir (la creamos antes con is_superadmin)
  const is_superadmin = role === "superadmin";
  const { error } = await supabase
    .from("user_roles")
    .upsert({ user_id: userId, is_superadmin }, { onConflict: "user_id" });
  if (error) throw error;
}

async function upsertProfile(userId, email, full_name) {
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, email, full_name, must_change_password: true },
      { onConflict: "id" }
    );
  if (error) throw error;
}

async function main() {
  if (users.length === 0) {
    console.log("⚠️ No hay usuarios en el array 'users'. Completalo y volvé a correr.");
    process.exit(1);
  }

  for (const u of users) {
    const password = initialPassword(u.role);

    console.log(`Creando: ${u.email} (${u.role})...`);

    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: u.full_name },
    });

    if (error) {
      // Si ya existe, lo reportamos y seguimos
      console.log(`  ⚠️ No creado (${u.email}): ${error.message}`);
      continue;
    }

    const userId = data.user.id;

    await upsertProfile(userId, u.email, u.full_name);
    await upsertRole(userId, u.role);

    console.log(`  ✅ OK user_id=${userId}`);
  }

  console.log("Listo.");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
