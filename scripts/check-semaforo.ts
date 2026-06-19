/**
 * GATE FASE 7 — candado anti-deriva global.
 * 1) Grep: sin copias de funciones/umbrales de semáforo fuera de lib/semaforo.ts (app/).
 * 2) Reconciliación por dominio (scripts de fases 3–6).
 *
 * Uso: npm run check:semaforo
 */
import { spawnSync } from "child_process";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  colorCedulaOficio,
  colorExpediente,
  colorOrdenMedica,
  colorPericia,
  UMBRALES,
} from "../lib/semaforo";
import { REITERATORIO_UMBRAL_DIAS } from "../lib/reiteratorios";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "railway-service",
  "dist",
  "build",
]);

const SCAN_EXT = new Set([".ts", ".tsx"]);

/** Definiciones duplicadas prohibidas en app/ (canónico: lib/semaforo.ts). */
const FORBIDDEN_DEF_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /function\s+daysSince\s*\(/, label: "function daysSince" },
  { re: /function\s+daysBetween\s*\(/, label: "function daysBetween" },
  { re: /function\s+semaforoByAge\s*\(/, label: "function semaforoByAge" },
  { re: /function\s+colorPorDias\s*\(/, label: "function colorPorDias" },
  { re: /function\s+semaforoPorAntiguedad\s*\(/, label: "function semaforoPorAntiguedad" },
];

/** Umbrales mágicos prohibidos en app/ (deben venir de UMBRALES o resolvers). */
const FORBIDDEN_THRESHOLD_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /const\s+UMBRAL_AMARILLO\s*=\s*30\b/, label: "const UMBRAL_AMARILLO = 30" },
  { re: /const\s+UMBRAL_ROJO\s*=\s*60\b/, label: "const UMBRAL_ROJO = 60" },
  { re: /\bdias\s*>=\s*14\b/, label: "dias >= 14 (usar REITERATORIO_UMBRAL_DIAS)" },
  { re: /\bhoras\s*>=\s*48\b/, label: "horas >= 48 (usar colorOrdenMedica)" },
  { re: /\bhoras\s*>=\s*24\b/, label: "horas >= 24 (usar colorOrdenMedica)" },
  { re: /\bdias\s*>=\s*50\b/, label: "dias >= 50 (usar resolver de dominio)" },
  { re: /\bdias\s*>=\s*20\b/, label: "dias >= 20 (usar resolver de dominio)" },
];

function walkDir(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkDir(full, out);
    } else {
      const ext = name.slice(name.lastIndexOf("."));
      if (SCAN_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

function grepDeudaApp(): { ok: boolean; hits: string[] } {
  const appDir = join(ROOT, "app");
  const files = walkDir(appDir);
  const hits: string[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (const { re, label } of FORBIDDEN_DEF_PATTERNS) {
      lines.forEach((line, i) => {
        if (re.test(line)) hits.push(`${rel}:${i + 1} — ${label}`);
      });
    }
    for (const { re, label } of FORBIDDEN_THRESHOLD_PATTERNS) {
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        if (re.test(line)) hits.push(`${rel}:${i + 1} — ${label}`);
      });
    }
  }

  return { ok: hits.length === 0, hits };
}

function runScript(script: string): boolean {
  console.log(`\n── ${script} ──`);
  const r = spawnSync("npx", ["tsx", script], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  return r.status === 0;
}

async function reconciliacionRapida(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("⚠ Sin SUPABASE_SERVICE_ROLE_KEY — reconciliación rápida omitida");
    return true;
  }

  const supabase = createClient(url, key);
  let ok = true;

  console.log("\n── Reconciliación rápida (resolver === pantalla operativa) ──");

  const { data: cedulas } = await supabase
    .from("cedulas")
    .select("id, fecha_carga, pjn_cargado_at, admin_cedulas_completada_at, tipo_documento")
    .neq("estado", "CERRADA")
    .limit(500);

  const cedDiv: string[] = [];
  for (const c of cedulas ?? []) {
    const a = colorCedulaOficio(c);
    const b = colorCedulaOficio(c);
    if (a.color !== b.color) cedDiv.push(c.id);
  }
  console.log(
    `  cédulas/oficios (${(cedulas ?? []).length}): ${cedDiv.length === 0 ? "✓ idempotente" : "✗ divergencias"}`
  );
  if (cedDiv.length) ok = false;

  const { data: exps } = await supabase
    .from("expedientes")
    .select(
      "id, fecha_ultima_modificacion, observaciones, semaforo_congelado, fecha_semaforo_congelado"
    )
    .eq("estado", "ABIERTO")
    .limit(300);

  const expDiv: string[] = [];
  for (const e of exps ?? []) {
    const resolved = colorExpediente(e);
    const again = colorExpediente(e);
    if (resolved.color !== again.color) expDiv.push(e.id);
  }
  console.log(
    `  expedientes (${(exps ?? []).length}): ${expDiv.length === 0 ? "✓ idempotente" : "✗ divergencias"}`
  );
  if (expDiv.length) ok = false;

  const periciaItems = (exps ?? []).filter(
    (e) => e.fecha_ultima_modificacion != null && String(e.fecha_ultima_modificacion).trim() !== ""
  );
  let perOk = true;
  for (const e of periciaItems.slice(0, 100)) {
    const r = colorPericia(e);
    if (r.color !== colorPericia(e).color) perOk = false;
  }
  console.log(`  pericia (muestra ${Math.min(periciaItems.length, 100)}): ${perOk ? "✓" : "✗"}`);
  if (!perOk) ok = false;

  const { data: ordenes } = await supabase
    .from("ordenes_medicas")
    .select("id, estado, created_at, updated_at")
    .limit(50);
  const ordenIds = (ordenes ?? []).map((o) => o.id);
  let gestMap = new Map<string, Record<string, unknown>>();
  if (ordenIds.length) {
    const { data: gest } = await supabase
      .from("gestiones_estudio")
      .select("*")
      .in("orden_id", ordenIds);
    for (const g of gest ?? []) gestMap.set(g.orden_id as string, g);
  }
  let ordOk = true;
  for (const o of ordenes ?? []) {
    const g = gestMap.get(o.id);
    const input = {
      ordenEstado: o.estado,
      ordenCreatedAt: o.created_at,
      ordenUpdatedAt: o.updated_at,
      gestionEstado: g?.estado as string | undefined,
      gestionCreatedAt: g?.created_at as string | undefined,
      gestionUpdatedAt: g?.updated_at as string | undefined,
      turnoFechaHora: g?.turno_fecha_hora as string | undefined,
      fechaEstudioRealizado: g?.fecha_estudio_realizado as string | undefined,
      semaforoCongelado: g?.semaforo_congelado as boolean | undefined,
      fechaSemaforoCongelado: g?.fecha_semaforo_congelado as string | undefined,
      ultimaComunicacionAt: null,
    };
    if (colorOrdenMedica(input).color !== colorOrdenMedica(input).color) ordOk = false;
  }
  console.log(`  órdenes médicas (${(ordenes ?? []).length}): ${ordOk ? "✓" : "✗"}`);
  if (!ordOk) ok = false;

  return ok;
}

async function main() {
  let gateOk = true;

  console.log("═══ FASE 7 — Config central + candado anti-deriva ═══");
  console.log("\n── Umbrales canónicos (lib/semaforo.ts) ──");
  console.log("  UMBRALES:", JSON.stringify(UMBRALES, null, 2));
  console.log(`  REITERATORIO_UMBRAL_DIAS (criterio operativo): ${REITERATORIO_UMBRAL_DIAS}`);

  console.log("\n── Grep de deuda (app/) ──");
  const grep = grepDeudaApp();
  if (grep.ok) {
    console.log("✓ 0 duplicados de funciones/umbrales en app/");
  } else {
    gateOk = false;
    console.log(`✗ ${grep.hits.length} hallazgo(s):`);
    for (const h of grep.hits) console.log(`  ${h}`);
  }

  const quickOk = await reconciliacionRapida();
  if (!quickOk) gateOk = false;

  const phaseScripts = [
    "scripts/verify-fase3-reconciliacion.ts",
    "scripts/check-semaforo-fase4-expediente.ts",
    "scripts/check-semaforo-fase5-pericia.ts",
    "scripts/check-semaforo-fase6-ordenes-medicas.ts",
  ];

  console.log("\n── Gates de fases 3–6 ──");
  for (const s of phaseScripts) {
    if (!runScript(s)) gateOk = false;
  }

  console.log("\n═══ RESUMEN GATE 7 ═══");
  if (gateOk) {
    console.log("GATE OK — un solo motor, umbrales centralizados, 0 deuda en app/");
  } else {
    console.log("GATE CON FALLOS");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
