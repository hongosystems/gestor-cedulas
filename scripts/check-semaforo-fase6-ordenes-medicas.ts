/**
 * GATE FASE 6 — colorOrdenMedica: horas activo (24/48), días estudio (20/50), turno vencido, renuncia.
 * Uso: npx tsx scripts/check-semaforo-fase6-ordenes-medicas.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  colorOrdenMedica,
  daysBetween,
  UMBRALES,
} from "../lib/semaforo";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

type GestionRow = {
  id: string;
  orden_id: string;
  estado: string;
  created_at: string;
  updated_at: string;
  turno_fecha_hora: string | null;
  fecha_estudio_realizado: string | null;
  semaforo_congelado?: boolean | null;
  fecha_semaforo_congelado?: string | null;
};

type OrdenRow = {
  id: string;
  case_ref: string | null;
  estado: string;
  created_at: string;
  updated_at: string;
};

function assertCase(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
  return ok;
}

function buildInput(
  orden: OrdenRow,
  gestion: GestionRow | null,
  ultimaComunicacionAt: string | null
) {
  return {
    ordenEstado: orden.estado,
    ordenCreatedAt: orden.created_at,
    ordenUpdatedAt: orden.updated_at,
    gestionEstado: gestion?.estado,
    gestionCreatedAt: gestion?.created_at,
    gestionUpdatedAt: gestion?.updated_at,
    turnoFechaHora: gestion?.turno_fecha_hora,
    fechaEstudioRealizado: gestion?.fecha_estudio_realizado,
    semaforoCongelado: gestion?.semaforo_congelado,
    fechaSemaforoCongelado: gestion?.fecha_semaforo_congelado,
    ultimaComunicacionAt,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Requerido: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  let gateOk = true;

  const { data: ordenes, error: ordErr } = await supabase
    .from("ordenes_medicas")
    .select("id, case_ref, estado, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (ordErr) {
    console.warn("BD ordenes_medicas:", ordErr.message, "— gate con casos sintéticos");
  }

  const ordenList = (ordenes ?? []) as OrdenRow[];
  const ordenIds = ordenList.map((o) => o.id);

  let gestiones: GestionRow[] = [];
  if (ordenIds.length > 0) {
    const { data: gestData } = await supabase
      .from("gestiones_estudio")
      .select(
        "id, orden_id, estado, created_at, updated_at, turno_fecha_hora, fecha_estudio_realizado, semaforo_congelado, fecha_semaforo_congelado"
      )
      .in("orden_id", ordenIds);
    gestiones = (gestData ?? []) as GestionRow[];
  }

  const gestionByOrden = new Map(gestiones.map((g) => [g.orden_id, g]));
  const gestionIds = gestiones.map((g) => g.id);

  const ultimaComByGestion = new Map<string, string>();
  if (gestionIds.length > 0) {
    const { data: coms } = await supabase
      .from("comunicaciones")
      .select("entidad_id, created_at")
      .eq("entidad_tipo", "GESTION")
      .in("entidad_id", gestionIds)
      .order("created_at", { ascending: false });
    for (const c of coms ?? []) {
      if (!ultimaComByGestion.has(c.entidad_id)) {
        ultimaComByGestion.set(c.entidad_id, c.created_at);
      }
    }
  }

  console.log("═══ FASE 6 — colorOrdenMedica (24/48 h · 20/50 días) ═══");
  console.log("Órdenes en BD:", ordenList.length);

  const ahora = new Date();

  // ── Casos sintéticos (siempre) ──
  console.log("\n── Casos sintéticos GATE ──");

  const hace10h = new Date(ahora.getTime() - 10 * 60 * 60 * 1000).toISOString();
  const turnoPasado = new Date(ahora.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const synthTurno = colorOrdenMedica(
    {
      ordenEstado: "EN_PROCESO",
      ordenCreatedAt: hace10h,
      gestionEstado: "TURNO_CONFIRMADO",
      gestionCreatedAt: hace10h,
      turnoFechaHora: turnoPasado,
      ultimaComunicacionAt: hace10h,
    },
    ahora
  );
  gateOk =
    assertCase(
      "Turno vencido (<48h → ROJO)",
      synthTurno.color === "ROJO" &&
        synthTurno.motivo === "turno_vencido" &&
        synthTurno.unidad === "horas" &&
        (synthTurno.valor ?? 99) < UMBRALES.ordenMedicaHoras.rojo,
      `color=${synthTurno.color} motivo=${synthTurno.motivo} valor=${synthTurno.valor}h label=${synthTurno.label}`
    ) && gateOk;

  const inicioEstudio = "2025-01-01T00:00:00.000Z";
  const finEstudio = "2025-02-15T00:00:00.000Z";
  const synthEstudio = colorOrdenMedica({
    ordenEstado: "EN_PROCESO",
    ordenCreatedAt: inicioEstudio,
    gestionEstado: "ESTUDIO_REALIZADO",
    gestionCreatedAt: inicioEstudio,
    fechaEstudioRealizado: finEstudio,
  });
  const diasEsperados = daysBetween(inicioEstudio, finEstudio);
  gateOk =
    assertCase(
      "Estudio realizado (días + color 20/50)",
      synthEstudio.unidad === "dias" &&
        synthEstudio.motivo === "estudio_realizado" &&
        synthEstudio.valor === diasEsperados &&
        synthEstudio.label?.includes("días desde estudio"),
      `color=${synthEstudio.color} dias=${synthEstudio.valor} label=${synthEstudio.label}`
    ) && gateOk;

  const synthRen = colorOrdenMedica({
    ordenEstado: "RENUNCIADO",
    ordenCreatedAt: "2025-01-01T00:00:00.000Z",
    ordenUpdatedAt: "2025-02-01T00:00:00.000Z",
  });
  gateOk =
    assertCase(
      "Renunciada (ROJO + días congelados)",
      synthRen.color === "ROJO" &&
        synthRen.motivo === "renunciado_orden" &&
        synthRen.unidad === "dias" &&
        synthRen.label?.includes("renunciado"),
      `color=${synthRen.color} dias=${synthRen.valor} label=${synthRen.label}`
    ) && gateOk;

  // ── Muestras BD ──
  console.log("\n── Muestras BD (si existen) ──");

  const renBd = ordenList.find((o) => o.estado === "RENUNCIADO");
  if (renBd) {
    const sla = colorOrdenMedica(buildInput(renBd, gestionByOrden.get(renBd.id) ?? null, null));
    console.log(
      `Renunciada BD ${renBd.case_ref ?? renBd.id.slice(0, 8)}: ${sla.color} | ${sla.unidad}=${sla.valor} | ${sla.label}`
    );
    if (sla.color !== "ROJO" || sla.motivo !== "renunciado_orden") gateOk = false;
  } else {
    const gestRen = gestiones.find(
      (g) => g.estado === "RENUNCIADO" || g.semaforo_congelado === true
    );
    if (gestRen) {
      const ord = ordenList.find((o) => o.id === gestRen.orden_id)!;
      const sla = colorOrdenMedica(
        buildInput(ord, gestRen, ultimaComByGestion.get(gestRen.id) ?? null)
      );
      console.log(
        `Gestión renunciada BD: ${sla.color} | ${sla.unidad}=${sla.valor} | motivo=${sla.motivo}`
      );
      if (sla.color !== "ROJO" || sla.motivo !== "renunciado_gestion") gateOk = false;
    } else {
      console.log("(sin renunciadas en BD — OK vía sintético)");
    }
  }

  const estBd = gestiones.find((g) => g.estado === "ESTUDIO_REALIZADO");
  if (estBd) {
    const ord = ordenList.find((o) => o.id === estBd.orden_id)!;
    const sla = colorOrdenMedica(
      buildInput(ord, estBd, ultimaComByGestion.get(estBd.id) ?? null)
    );
    console.log(
      `Estudio BD: ${sla.color} | ${sla.unidad}=${sla.valor} | ${sla.label}`
    );
    if (sla.unidad !== "dias" || sla.motivo !== "estudio_realizado") gateOk = false;
  } else {
    console.log("(sin estudio realizado en BD — OK vía sintético)");
  }

  const turnoBd = gestiones.find((g) => {
    if (!g.turno_fecha_hora) return false;
    const t = new Date(g.turno_fecha_hora);
    if (t >= ahora) return false;
    if (g.estado === "ESTUDIO_REALIZADO" || g.estado === "RENUNCIADO") return false;
    if (g.semaforo_congelado) return false;
    const ord = ordenList.find((o) => o.id === g.orden_id);
    return ord != null && ord.estado !== "RENUNCIADO";
  });
  if (turnoBd) {
    const ord = ordenList.find((o) => o.id === turnoBd.orden_id)!;
    const sla = colorOrdenMedica(
      buildInput(ord, turnoBd, ultimaComByGestion.get(turnoBd.id) ?? null),
      ahora
    );
    console.log(
      `Turno vencido BD: ${sla.color} | motivo=${sla.motivo} | ${sla.valor}h | ${sla.label}`
    );
    if (sla.color !== "ROJO" || sla.motivo !== "turno_vencido") gateOk = false;
  } else {
    console.log("(sin turno vencido activo en BD — OK vía sintético)");
  }

  console.log("\n── Umbrales canónicos ──");
  console.log(
    `  activo: ${UMBRALES.ordenMedicaHoras.amarillo}h / ${UMBRALES.ordenMedicaHoras.rojo}h`
  );
  console.log(
    `  estudio: ${UMBRALES.ordenMedicaDias.amarillo}d / ${UMBRALES.ordenMedicaDias.rojo}d`
  );

  console.log("\n═══ RESUMEN GATE 6 ═══");
  console.log(gateOk ? "GATE OK" : "GATE CON FALLOS");
  if (!gateOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
