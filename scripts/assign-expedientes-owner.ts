/**
 * PASO 2 — Asignación segura de owner en expedientes rojos sin responsable.
 *
 * dry_run=true por defecto. Ejecución real:
 *   DRY_RUN=false EXECUTOR_USER_ID=<uuid-superadmin> npx tsx scripts/assign-expedientes-owner.ts
 *
 * Opcional: USAR_JUZGADO_COMO_OWNER=true (apagado por defecto)
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  buildAssignPlan,
  buildCedulaOwnerIndex,
  buildDiagReport,
  buildExpedientesUnificados,
  buildRojosSinOwnerExpedientes,
  loadPjnFavoritosForOwner,
  type CedulaForOwnerSignal,
  type ExpedienteForOwner,
  type AssignPlanItem,
} from "../lib/expediente-owner-resolve";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

const DRY_RUN = process.env.DRY_RUN !== "false";
const EXECUTOR_USER_ID = process.env.EXECUTOR_USER_ID?.trim() || "";
const USAR_JUZGADO_COMO_OWNER = process.env.USAR_JUZGADO_COMO_OWNER === "true";

async function requireSuperadmin(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_superadmin === true;
}

async function insertAudit(
  supabase: ReturnType<typeof createClient>,
  row: {
    expediente_id: string | null;
    pjn_favorito_id: string | null;
    owner_asignado: string;
    owner_anterior: string | null;
    senal: string;
    ejecutado_por: string;
    dry_run: boolean;
  }
) {
  const { error } = await supabase.from("expedientes_owner_audit").insert(row);
  if (error?.message?.includes("Could not find the table")) {
    console.warn(
      "⚠ Tabla expedientes_owner_audit ausente — ejecutá migrations/expedientes_owner_audit.sql en Supabase SQL Editor"
    );
    console.warn("  Audit pendiente:", JSON.stringify(row));
    return;
  }
  if (error) throw new Error(`Audit insert failed: ${error.message}`);
}

async function createLocalFromPjn(
  supabase: ReturnType<typeof createClient>,
  item: AssignPlanItem,
  ownerId: string,
  executorId: string
): Promise<string> {
  const favId = item.id.replace(/^pjn_/, "");
  const { data: fav, error: favErr } = await supabase
    .from("pjn_favoritos")
    .select("id, caratula, juzgado, jurisdiccion, numero, anio, fecha_ultima_carga, observaciones")
    .eq("id", favId)
    .maybeSingle();
  if (favErr || !fav) throw new Error(`Favorito PJN no encontrado: ${favId}`);

  const fechaRaw = fav.fecha_ultima_carga;
  let fechaISO: string;
  if (fechaRaw && /^\d{2}\/\d{2}\/\d{4}$/.test(fechaRaw.trim())) {
    const [d, m, y] = fechaRaw.trim().split("/");
    fechaISO = `${y}-${m}-${d}T00:00:00.000Z`;
  } else if (fechaRaw) {
    fechaISO = new Date(fechaRaw).toISOString();
  } else {
    fechaISO = new Date().toISOString();
  }

  const insertPayload: Record<string, unknown> = {
    owner_user_id: ownerId,
    caratula: (fav.caratula || item.caratula || "Sin carátula").trim().slice(0, 500),
    juzgado: fav.juzgado || item.juzgado || null,
    numero_expediente: `${fav.jurisdiccion} ${fav.numero}/${fav.anio}`,
    fecha_ultima_modificacion: fechaISO,
    estado: "ABIERTO",
    created_by_user_id: executorId,
    observaciones: "Creado desde favorito PJN — asignación automática de responsable.",
  };

  const { data: created, error: insErr } = await supabase
    .from("expedientes")
    .insert(insertPayload)
    .select("id")
    .single();
  if (insErr || !created?.id) {
    throw new Error(`Insert expediente failed: ${insErr?.message ?? "unknown"}`);
  }
  return created.id as string;
}

async function assignOwnerLocal(
  supabase: ReturnType<typeof createClient>,
  expedienteId: string,
  ownerId: string,
  ownerAnterior: string | null
) {
  const { error } = await supabase
    .from("expedientes")
    .update({ owner_user_id: ownerId })
    .eq("id", expedienteId);
  if (error) throw new Error(`Update owner failed: ${error.message}`);
  return ownerAnterior;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Requerido: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  if (!DRY_RUN && !EXECUTOR_USER_ID) {
    console.error("Ejecución real requiere EXECUTOR_USER_ID (superadmin)");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);

  if (!DRY_RUN) {
    const ok = await requireSuperadmin(supabase, EXECUTOR_USER_ID);
    if (!ok) {
      console.error("EXECUTOR_USER_ID no es superadmin");
      process.exit(1);
    }
  }

  const [
    { data: cedulasRaw, error: cErr },
    { data: expsRaw, error: eErr },
    { data: userJuzgadosRows },
  ] = await Promise.all([
    supabase
      .from("cedulas")
      .select("id, owner_user_id, ocr_exp_nro, tipo_documento, estado")
      .neq("estado", "CERRADA"),
    supabase
      .from("expedientes")
      .select(
        "id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado"
      )
      .eq("estado", "ABIERTO"),
    supabase.from("user_juzgados").select("user_id, juzgado"),
  ]);

  if (cErr) throw cErr;
  if (eErr) throw eErr;

  const cedulas = (cedulasRaw ?? []) as CedulaForOwnerSignal[];
  const allExpedientes = (expsRaw ?? []) as ExpedienteForOwner[];
  const localIds = new Set(allExpedientes.map((e) => e.id));
  const localById = new Map(allExpedientes.map((e) => [e.id, e]));
  const pjnFavoritos = await loadPjnFavoritosForOwner(supabase);
  const expedientesUnificados = buildExpedientesUnificados(allExpedientes, pjnFavoritos);
  const cedulaIndex = buildCedulaOwnerIndex(cedulas);
  const rojosSinOwner = buildRojosSinOwnerExpedientes(expedientesUnificados);
  const report = buildDiagReport(rojosSinOwner, localIds, cedulaIndex, userJuzgadosRows ?? [], {
    usarJuzgadoComoOwner: USAR_JUZGADO_COMO_OWNER,
  });
  const plan = buildAssignPlan(report, { usarJuzgadoComoOwner: USAR_JUZGADO_COMO_OWNER });

  const toAssign = plan.filter(
    (p) => p.action === "assign_owner" || p.action === "create_local_and_assign"
  );
  const manual = plan.filter((p) => p.action === "manual");
  const monitoreo = plan.filter((p) => p.action === "monitoreo");

  console.log("═══ GATE 2 — Asignación segura de owner ═══");
  console.log(`Modo: ${DRY_RUN ? "DRY-RUN (sin escritura)" : "EJECUCIÓN REAL"}`);
  console.log(`USAR_JUZGADO_COMO_OWNER: ${USAR_JUZGADO_COMO_OWNER}`);
  if (!DRY_RUN) console.log(`Ejecutor: ${EXECUTOR_USER_ID}`);

  console.log("\n| Regla | Acción | Conteo |");
  console.log("|-------|--------|--------|");
  console.log(`| A | assign_owner (local) | ${plan.filter((p) => p.categoria === "A").length} |`);
  console.log(
    `| D | create_local_and_assign (PJN→local) | ${plan.filter((p) => p.categoria === "D").length} |`
  );
  console.log(
    `| B | juzgado único (flag) | ${USAR_JUZGADO_COMO_OWNER ? plan.filter((p) => p.categoria === "B").length : 0} |`
  );
  console.log(`| C | manual (no tocar) | ${manual.length} |`);
  console.log(`| E | monitoreo PJN (no tocar) | ${monitoreo.length} |`);
  console.log(`| **Total asignaría** | | **${toAssign.length}** |`);

  console.log("\n─── Detalle asignaciones propuestas ───");
  for (const item of toAssign) {
    console.log(
      `  ${item.action} | ${item.id.slice(0, 20)} | owner=${item.proposedOwner} | ${item.proposedSignal} | ${item.numeroExpediente}`
    );
  }

  if (DRY_RUN) {
    console.log("\n✓ Dry-run completo. Para ejecutar:");
    console.log(
      "  $env:DRY_RUN='false'; $env:EXECUTOR_USER_ID='<uuid-superadmin>'; npx tsx scripts/assign-expedientes-owner.ts"
    );
    return;
  }

  let applied = 0;
  let failed = 0;

  for (const item of toAssign) {
    if (!item.proposedOwner || !item.proposedSignal) continue;
    try {
      let expedienteId: string;
      let pjnFavoritoId: string | null = null;
      let ownerAnterior: string | null = null;

      if (item.action === "create_local_and_assign") {
        pjnFavoritoId = item.id.replace(/^pjn_/, "");
        expedienteId = await createLocalFromPjn(
          supabase,
          item,
          item.proposedOwner,
          EXECUTOR_USER_ID
        );
      } else {
        expedienteId = item.id;
        const local = localById.get(item.id);
        ownerAnterior = local?.owner_user_id?.trim() || null;
        await assignOwnerLocal(supabase, expedienteId, item.proposedOwner, ownerAnterior);
      }

      await insertAudit(supabase, {
        expediente_id: expedienteId,
        pjn_favorito_id: pjnFavoritoId,
        owner_asignado: item.proposedOwner,
        owner_anterior: ownerAnterior,
        senal: item.proposedSignal,
        ejecutado_por: EXECUTOR_USER_ID,
        dry_run: false,
      });
      applied++;
      console.log(`✓ ${item.numeroExpediente} → ${item.proposedOwner}`);
    } catch (err) {
      failed++;
      console.error(`✗ ${item.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nAplicadas: ${applied}, fallidas: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
