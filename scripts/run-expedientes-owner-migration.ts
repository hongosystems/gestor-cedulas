/**
 * Aplica migrations/expedientes_owner_audit.sql vía RPC exec_sql (service role).
 * Uso: npx tsx scripts/run-expedientes-owner-migration.ts
 */
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const sql = readFileSync(
    resolve(process.cwd(), "migrations/expedientes_owner_audit.sql"),
    "utf8"
  );

  // Quitar comentarios y bloques vacíos; ejecutar statement por statement
  const statements = sql
    .split(";")
    .map((s) => s.replace(/^--[^\n]*\n?/gm, "").trim())
    .filter((s) => s.length > 0 && !s.startsWith("/*"));

  for (const stmt of statements) {
    const preview = stmt.slice(0, 60).replace(/\s+/g, " ");
    console.log(`→ ${preview}…`);
    const { error } = await supabase.rpc("exec_sql", { sql: stmt });
    if (error) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  }

  const { error: checkErr } = await supabase.from("expedientes_owner_audit").select("id").limit(1);
  if (checkErr) {
    console.error("Verificación falló:", checkErr.message);
    process.exit(1);
  }
  console.log("✓ Migración expedientes_owner_audit aplicada");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
