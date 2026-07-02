/**
 * Vincula ordenes_medicas sin expediente_id al expediente local por case_ref.
 * Uso: npx tsx scripts/backfill-ordenes-expediente-id.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { matchKeyFromParts, parseExpedienteFromNumero } from "../lib/expediente-pjn-merge";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Requerido: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

function numeroVariants(ref: string): string[] {
  const parts = parseExpedienteFromNumero(ref);
  if (!parts) return [ref.trim()];
  const { jurisdiccion, numero, anio } = parts;
  const n = parseInt(numero, 10);
  return [
    ref.trim(),
    `${jurisdiccion} ${numero}/${anio}`,
    `${jurisdiccion} ${String(n).padStart(6, "0")}/${anio}`,
    `${numero}/${anio}`,
    `${String(n).padStart(6, "0")}/${anio}`,
    `${n}/${anio}`,
  ];
}

async function main() {
  const { data: ordenes, error } = await supabase
    .from("ordenes_medicas")
    .select("id, case_ref, expediente_id")
    .is("expediente_id", null);

  if (error) throw error;
  console.log(`Órdenes sin expediente_id: ${ordenes?.length ?? 0}`);

  const { data: expedientes, error: expErr } = await supabase
    .from("expedientes")
    .select("id, numero_expediente");
  if (expErr) throw expErr;

  const byKey = new Map<string, string>();
  for (const e of expedientes ?? []) {
    const ref = (e.numero_expediente || "").trim();
    if (!ref) continue;
    const parts = parseExpedienteFromNumero(ref);
    if (parts) byKey.set(matchKeyFromParts(parts), e.id);
    byKey.set(ref, e.id);
  }

  let linked = 0;
  let skipped = 0;

  for (const orden of ordenes ?? []) {
    const refs = numeroVariants(orden.case_ref || "");
    let expedienteId: string | null = null;
    for (const ref of refs) {
      const parts = parseExpedienteFromNumero(ref);
      if (parts) {
        const id = byKey.get(matchKeyFromParts(parts));
        if (id) {
          expedienteId = id;
          break;
        }
      }
      const id = byKey.get(ref);
      if (id) {
        expedienteId = id;
        break;
      }
    }

    if (!expedienteId) {
      skipped++;
      continue;
    }

    const { error: updErr } = await supabase
      .from("ordenes_medicas")
      .update({ expediente_id: expedienteId })
      .eq("id", orden.id);

    if (updErr) {
      console.error(`Error ${orden.id}:`, updErr.message);
      continue;
    }
    linked++;
    console.log(`✓ ${orden.case_ref} → expediente ${expedienteId.slice(0, 8)}…`);
  }

  console.log(`\nVinculadas: ${linked} | Sin match local: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
