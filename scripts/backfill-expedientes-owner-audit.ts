/**
 * Backfill expedientes_owner_audit desde logs de assign (si la migración se aplicó después).
 * Pegá las líneas JSON de "Audit pendiente" en scripts/.pending-owner-audit.jsonl
 * Uso: npx tsx scripts/backfill-expedientes-owner-audit.ts
 *
 * Tras cada INSERT exitoso, reescribe el .jsonl sin esa línea (truncado progresivo).
 */
import dotenv from "dotenv";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const PENDING = resolve(process.cwd(), "scripts/.pending-owner-audit.jsonl");

function writePending(lines: string[]) {
  if (lines.length === 0) {
    if (existsSync(PENDING)) unlinkSync(PENDING);
    return;
  }
  writeFileSync(PENDING, lines.join("\n") + "\n", "utf8");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) process.exit(1);

  const supabase = createClient(url, key);
  const { error: check } = await supabase.from("expedientes_owner_audit").select("id").limit(1);
  if (check) {
    console.error("Tabla expedientes_owner_audit no existe:", check.message);
    process.exit(1);
  }

  if (!existsSync(PENDING)) {
    console.log("Sin archivo pending. Creá scripts/.pending-owner-audit.jsonl con los JSON del assign.");
    return;
  }

  const pending = readFileSync(PENDING, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const total = pending.length;
  let ok = 0;

  while (pending.length > 0) {
    const line = pending[0];
    const row = JSON.parse(line) as { expediente_id?: string };
    const { error } = await supabase.from("expedientes_owner_audit").insert(row);
    if (error) {
      console.error("Error:", error.message, row.expediente_id ?? "");
      console.log(`Backfill: ${ok}/${total} insertadas; ${pending.length} pendiente(s) en .jsonl`);
      return;
    }
    ok++;
    pending.shift();
    writePending(pending);
  }

  console.log(`Backfill: ${ok}/${total} filas insertadas; pending eliminado`);
}

main().catch(console.error);
