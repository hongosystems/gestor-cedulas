// lib/semaforo.ts

export type SemaforoColor = "VERDE" | "AMARILLO" | "ROJO";

export const UMBRAL_AMARILLO_DIAS = 30; // desde 30 días = amarillo
export const UMBRAL_ROJO_DIAS = 60;     // desde 60 días = rojo
export const LEGACY_SEMAFORO_CUTOFF_DATE = process.env.NEXT_PUBLIC_SEMAFORO_LEGACY_CUTOFF_DATE || null;

/** Umbrales por dominio — única fuente de verdad (FASE 7). */
export const UMBRALES = {
  cedulaOficio: { amarillo: 30, rojo: 60 },
  expediente: { amarillo: 30, rojo: 60 },
  pericia: { amarillo: 20, rojo: 50 },
  ordenMedicaDias: { amarillo: 20, rojo: 50 },
  ordenMedicaHoras: { amarillo: 24, rojo: 48 },
  reiteratorioDias: 14, // criterio operativo (no semáforo) — ver lib/reiteratorios.ts
} as const;

export type UmbralDias = { amarillo: number; rojo: number };

export type CedulaOficioColorInput = {
  fecha_carga?: string | null;
  pjn_cargado_at?: string | null;
  admin_cedulas_completada_at?: string | null;
};

export type CedulaOficioCongeladoMotivo = "pjn" | "completada" | null;

export type CedulaOficioColorResult = {
  color: SemaforoColor;
  dias: number | null;
  congelado: boolean;
  motivo: CedulaOficioCongeladoMotivo;
  /** true cuando legacy bajó ROJO → AMARILLO */
  legacyClampAplicado: boolean;
  colorSinLegacy: SemaforoColor;
};

export function colorPorDias(dias: number, umbral: UmbralDias = UMBRALES.cedulaOficio): SemaforoColor {
  if (dias >= umbral.rojo) return "ROJO";
  if (dias >= umbral.amarillo) return "AMARILLO";
  return "VERDE";
}

/** Alias histórico — preferir colorPorDias. */
export function semaforoByAge(diasDesdeCarga: number, umbral: UmbralDias = UMBRALES.cedulaOficio): SemaforoColor {
  return colorPorDias(diasDesdeCarga, umbral);
}

export function clampLegacy(color: SemaforoColor, cargaISO: string): SemaforoColor {
  if (!isLegacySemaforoDate(cargaISO)) return color;
  if (color === "ROJO") return "AMARILLO";
  return color;
}

/** @deprecated Usar clampLegacy */
export function clampLegacySemaforo(color: SemaforoColor, cargaISO: string): SemaforoColor {
  return clampLegacy(color, cargaISO);
}

/**
 * Resolver canónico cédulas/oficios — misma lógica que Mis Cédulas (congelado + legacy).
 */
export function colorCedulaOficio(doc: CedulaOficioColorInput): CedulaOficioColorResult {
  const cargaISO = doc.fecha_carga || "";
  if (!cargaISO) {
    return {
      color: "VERDE",
      dias: null,
      congelado: false,
      motivo: null,
      legacyClampAplicado: false,
      colorSinLegacy: "VERDE",
    };
  }

  let dias: number;
  let congelado = false;
  let motivo: CedulaOficioCongeladoMotivo = null;

  if (doc.pjn_cargado_at) {
    dias = daysBetween(cargaISO, doc.pjn_cargado_at);
    congelado = true;
    motivo = "pjn";
  } else if (doc.admin_cedulas_completada_at) {
    dias = daysBetween(cargaISO, doc.admin_cedulas_completada_at);
    congelado = true;
    motivo = "completada";
  } else {
    dias = daysSince(cargaISO);
  }

  if (isNaN(dias) || dias < 0) {
    return {
      color: "VERDE",
      dias: null,
      congelado,
      motivo,
      legacyClampAplicado: false,
      colorSinLegacy: "VERDE",
    };
  }

  const colorSinLegacy = colorPorDias(dias, UMBRALES.cedulaOficio);
  const color = clampLegacy(colorSinLegacy, cargaISO);
  const legacyClampAplicado = colorSinLegacy === "ROJO" && color === "AMARILLO";

  return { color, dias, congelado, motivo, legacyClampAplicado, colorSinLegacy };
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseIsoDateOnly(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : startOfDay(d);
}

/**
 * Calcula los días desde una fecha, excluyendo los días de enero (feria judicial)
 * @param fechaCargaIso Fecha en formato ISO
 * @returns Número de días efectivos (excluyendo enero)
 */
export function daysSince(fechaCargaIso: string | null | undefined): number {
  if (!fechaCargaIso) return 0;
  const carga = new Date(fechaCargaIso);
  if (isNaN(carga.getTime())) return 0;

  const today = startOfDay(new Date());
  const base = startOfDay(carga);
  
  // Calcular días totales
  const diffMs = today.getTime() - base.getTime();
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  // Contar días de enero (feria judicial) en el rango
  let eneroDays = 0;
  const currentDate = new Date(base);
  
  while (currentDate <= today) {
    // Si el día actual es de enero (mes 0 en JavaScript), contarlo
    if (currentDate.getMonth() === 0) { // Enero es mes 0
      eneroDays++;
    }
    // Avanzar un día
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Retornar días efectivos (total - días de enero)
  return Math.max(0, totalDays - eneroDays);
}

/**
 * Calcula los días entre dos fechas, excluyendo los días de enero (feria judicial)
 * @param fechaInicioIso Fecha de inicio en formato ISO
 * @param fechaFinIso Fecha de fin en formato ISO
 * @returns Número de días efectivos entre las dos fechas (excluyendo enero)
 */
export function daysBetween(
  fechaInicioIso: string | null | undefined,
  fechaFinIso: string | null | undefined
): number {
  if (!fechaInicioIso || !fechaFinIso) return 0;
  const inicio = new Date(fechaInicioIso);
  const fin = new Date(fechaFinIso);
  if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) return 0;
  if (fin < inicio) return 0;

  const base = startOfDay(inicio);
  const endDate = startOfDay(fin);

  const diffMs = endDate.getTime() - base.getTime();
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let eneroDays = 0;
  const currentDate = new Date(base);

  while (currentDate <= endDate) {
    if (currentDate.getMonth() === 0) {
      eneroDays++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return Math.max(0, totalDays - eneroDays);
}

export function colorFromFechaCarga(fechaCargaIso: string | null | undefined): SemaforoColor {
  return colorPorDias(daysSince(fechaCargaIso), UMBRALES.cedulaOficio);
}

/**
 * Indica si una fecha de carga cae antes (o en) la fecha de corte legacy
 * para evitar tratar registros históricos como "rojos" por antigüedad.
 */
export function isLegacySemaforoDate(fechaCargaIso: string | null | undefined): boolean {
  if (!fechaCargaIso || !LEGACY_SEMAFORO_CUTOFF_DATE) return false;
  const carga = new Date(fechaCargaIso);
  if (isNaN(carga.getTime())) return false;
  const cutoff = parseIsoDateOnly(LEGACY_SEMAFORO_CUTOFF_DATE);
  if (!cutoff) return false;
  return startOfDay(carga).getTime() <= cutoff.getTime();
}

export function labelFromColor(c: SemaforoColor) {
  if (c === "ROJO") return "ROJO";
  if (c === "AMARILLO") return "AMARILLO";
  return "VERDE";
}

/** Convierte DD/MM/AAAA o YYYY-MM-DD a ISO (medianoche UTC). */
export function ddmmaaaaToISO(fecha: string | null | undefined): string | null {
  if (!fecha || fecha.trim() === "") return null;
  const fechaTrim = fecha.trim();
  const m1 = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fechaTrim);
  if (m1) {
    const [, dia, mes, anio] = m1;
    return `${anio}-${mes}-${dia}T00:00:00.000Z`;
  }
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaTrim);
  if (m2) {
    const [, anio, mes, dia] = m2;
    return `${anio}-${mes}-${dia}T00:00:00.000Z`;
  }
  return null;
}

export type ExpedienteColorInput = {
  fecha_ultima_modificacion?: string | null;
  fecha_ultima_carga?: string | null;
  observaciones?: string | null;
  semaforo_congelado?: boolean | null;
  fecha_semaforo_congelado?: string | null;
};

export type ExpedienteCongeladoMotivo = "renuncia" | null;

export type ExpedienteColorResult = {
  color: SemaforoColor;
  dias: number | null;
  fechaBase: string | null;
  congelado: boolean;
  motivo: ExpedienteCongeladoMotivo;
};

export function isExpedienteRenunciado(
  exp: Pick<ExpedienteColorInput, "observaciones" | "semaforo_congelado" | "fecha_semaforo_congelado">
): boolean {
  if (exp.semaforo_congelado === true) return true;
  if (exp.fecha_semaforo_congelado?.trim()) return true;
  return (exp.observaciones || "").trim().toUpperCase().startsWith("RENUNCIADO");
}

/** Fecha base unificada: ult. modificación ISO, o fallback carga PJN (DD/MM/AAAA). */
export function getFechaBaseExpediente(
  exp: Pick<ExpedienteColorInput, "fecha_ultima_modificacion" | "fecha_ultima_carga">
): string | null {
  if (exp.fecha_ultima_modificacion?.trim()) {
    return exp.fecha_ultima_modificacion;
  }
  if (exp.fecha_ultima_carga?.trim()) {
    return ddmmaaaaToISO(exp.fecha_ultima_carga);
  }
  return null;
}

/** Resolver canónico expedientes — misma lógica en dashboard, Mis Juzgados, abogado y admin. */
export function colorExpediente(exp: ExpedienteColorInput): ExpedienteColorResult {
  const renunciado = isExpedienteRenunciado(exp);
  const fechaBase = getFechaBaseExpediente(exp);

  if (renunciado) {
    let dias: number | null = null;
    if (fechaBase && exp.fecha_semaforo_congelado?.trim()) {
      dias = daysBetween(fechaBase, exp.fecha_semaforo_congelado);
    } else if (fechaBase) {
      dias = daysSince(fechaBase);
    }
    return { color: "ROJO", dias, fechaBase, congelado: true, motivo: "renuncia" };
  }

  if (!fechaBase) {
    return { color: "VERDE", dias: null, fechaBase: null, congelado: false, motivo: null };
  }

  const dias = daysSince(fechaBase);
  if (isNaN(dias) || dias < 0) {
    return { color: "VERDE", dias: null, fechaBase, congelado: false, motivo: null };
  }

  return {
    color: colorPorDias(dias, UMBRALES.expediente),
    dias,
    fechaBase,
    congelado: false,
    motivo: null,
  };
}

// ─── Prueba / Pericia ───────────────────────────────────────────────────────

export type PericiaColorInput = {
  fecha_ultima_modificacion?: string | null;
  fecha_ultima_carga?: string | null;
  observaciones?: string | null;
  semaforo_congelado?: boolean | null;
  fecha_semaforo_congelado?: string | null;
};

export type PericiaColorResult = {
  color: SemaforoColor;
  dias: number | null;
  fechaBase: string | null;
  congelado: boolean;
  renunciado: boolean;
};

export function isPericiaRenunciado(
  item: Pick<PericiaColorInput, "observaciones" | "semaforo_congelado">
): boolean {
  if (item.semaforo_congelado === true) return true;
  return (item.observaciones || "").trim().toUpperCase().startsWith("RENUNCIADO");
}

export function getFechaBasePericia(
  item: Pick<PericiaColorInput, "fecha_ultima_modificacion" | "fecha_ultima_carga">
): string | null {
  return getFechaBaseExpediente(item);
}

/** Texto estándar de observaciones al renunciar (Prueba/Pericia). */
export function periciaRenunciaObservaciones(razon: string): string {
  return `RENUNCIADO: ${razon.trim()}`;
}

/** Resolver canónico Prueba/Pericia — umbrales 20/50; congelado usa daysBetween (excluye enero). */
export function colorPericia(item: PericiaColorInput): PericiaColorResult {
  const renunciado = isPericiaRenunciado(item);
  const fechaBase = getFechaBasePericia(item);

  if (renunciado) {
    let dias: number | null = null;
    if (fechaBase && item.fecha_semaforo_congelado?.trim()) {
      dias = daysBetween(fechaBase, item.fecha_semaforo_congelado);
    } else if (fechaBase) {
      dias = daysSince(fechaBase);
    }
    return { color: "ROJO", dias, fechaBase, congelado: true, renunciado: true };
  }

  if (!fechaBase) {
    return { color: "VERDE", dias: null, fechaBase: null, congelado: false, renunciado: false };
  }

  const dias = daysSince(fechaBase);
  if (isNaN(dias) || dias < 0) {
    return { color: "VERDE", dias: null, fechaBase, congelado: false, renunciado: false };
  }

  return {
    color: colorPorDias(dias, UMBRALES.pericia),
    dias,
    fechaBase,
    congelado: false,
    renunciado: false,
  };
}

// ─── Órdenes médicas ────────────────────────────────────────────────────────

export type UmbralHoras = { amarillo: number; rojo: number };

export function colorPorHoras(
  horas: number,
  umbral: UmbralHoras = UMBRALES.ordenMedicaHoras
): SemaforoColor {
  if (horas >= umbral.rojo) return "ROJO";
  if (horas >= umbral.amarillo) return "AMARILLO";
  return "VERDE";
}

export type OrdenMedicaSlaMotivo =
  | "renunciado_orden"
  | "renunciado_gestion"
  | "estudio_realizado"
  | "activo"
  | "turno_vencido"
  | "sin_gestion";

export type OrdenMedicaColorInput = {
  ordenEstado?: string | null;
  ordenCreatedAt?: string | null;
  ordenUpdatedAt?: string | null;
  gestionEstado?: string | null;
  gestionCreatedAt?: string | null;
  gestionUpdatedAt?: string | null;
  turnoFechaHora?: string | null;
  fechaEstudioRealizado?: string | null;
  semaforoCongelado?: boolean | null;
  fechaSemaforoCongelado?: string | null;
  ultimaComunicacionAt?: string | null;
};

export type OrdenMedicaColorResult = {
  color: SemaforoColor;
  unidad: "horas" | "dias" | null;
  valor: number | null;
  motivo: OrdenMedicaSlaMotivo;
  label: string | null;
  turnoVencido: boolean;
};

export function formatOrdenMedicaSlaLabel(
  result: Pick<OrdenMedicaColorResult, "unidad" | "valor" | "motivo" | "turnoVencido">
): string | null {
  if (result.turnoVencido && result.motivo === "turno_vencido") {
    if (result.unidad === "horas" && result.valor != null) {
      return `${result.valor} h sin contacto · turno vencido`;
    }
    return "Turno vencido";
  }
  if (result.unidad === "horas" && result.valor != null) {
    return `${result.valor} h sin contacto`;
  }
  if (result.unidad === "dias" && result.valor != null) {
    if (result.motivo === "estudio_realizado") {
      return `${result.valor} días desde estudio`;
    }
    if (result.motivo === "renunciado_orden" || result.motivo === "renunciado_gestion") {
      return `${result.valor} días (renunciado)`;
    }
    return `${result.valor} días`;
  }
  return null;
}

export function colorOrdenMedica(
  input: OrdenMedicaColorInput,
  ahora: Date = new Date()
): OrdenMedicaColorResult {
  const sinGestion: OrdenMedicaColorResult = {
    color: "VERDE",
    unidad: null,
    valor: null,
    motivo: "sin_gestion",
    label: null,
    turnoVencido: false,
  };

  if (input.ordenEstado === "RENUNCIADO") {
    const fechaFin = input.ordenUpdatedAt || input.ordenCreatedAt;
    const fechaInicio = input.ordenCreatedAt;
    const dias =
      fechaInicio && fechaFin ? daysBetween(fechaInicio, fechaFin) : null;
    const result: OrdenMedicaColorResult = {
      color: "ROJO",
      unidad: dias != null ? "dias" : null,
      valor: dias,
      motivo: "renunciado_orden",
      label: null,
      turnoVencido: false,
    };
    result.label = formatOrdenMedicaSlaLabel(result);
    return result;
  }

  const tieneGestion =
    input.gestionEstado != null ||
    input.gestionCreatedAt != null ||
    input.gestionUpdatedAt != null;

  if (!tieneGestion) {
    return sinGestion;
  }

  if (input.gestionEstado === "RENUNCIADO" || input.semaforoCongelado === true) {
    const fechaFin =
      input.fechaSemaforoCongelado || input.gestionUpdatedAt || input.ordenUpdatedAt;
    const fechaInicio = input.gestionCreatedAt || input.ordenCreatedAt;
    const dias =
      fechaInicio && fechaFin ? daysBetween(fechaInicio, fechaFin) : null;
    const result: OrdenMedicaColorResult = {
      color: "ROJO",
      unidad: dias != null ? "dias" : null,
      valor: dias,
      motivo: "renunciado_gestion",
      label: null,
      turnoVencido: false,
    };
    result.label = formatOrdenMedicaSlaLabel(result);
    return result;
  }

  if (input.gestionEstado === "ESTUDIO_REALIZADO") {
    const fechaFin =
      input.fechaEstudioRealizado || input.gestionUpdatedAt || input.ordenUpdatedAt;
    const fechaInicio = input.gestionCreatedAt || input.ordenCreatedAt;
    const dias =
      fechaInicio && fechaFin ? daysBetween(fechaInicio, fechaFin) : null;
    const result: OrdenMedicaColorResult = {
      color: dias != null ? colorPorDias(dias, UMBRALES.ordenMedicaDias) : "VERDE",
      unidad: dias != null ? "dias" : null,
      valor: dias,
      motivo: "estudio_realizado",
      label: null,
      turnoVencido: false,
    };
    result.label = formatOrdenMedicaSlaLabel(result);
    return result;
  }

  let horas: number | null = null;
  if (input.ultimaComunicacionAt) {
    const fechaComunicacion = new Date(input.ultimaComunicacionAt);
    horas = Math.floor(
      (ahora.getTime() - fechaComunicacion.getTime()) / (1000 * 60 * 60)
    );
  } else if (input.gestionCreatedAt) {
    const fechaGestion = new Date(input.gestionCreatedAt);
    horas = Math.floor(
      (ahora.getTime() - fechaGestion.getTime()) / (1000 * 60 * 60)
    );
  }

  if (horas == null) {
    return sinGestion;
  }

  let color = colorPorHoras(horas);
  let turnoVencido = false;
  let motivo: OrdenMedicaSlaMotivo = "activo";

  if (input.turnoFechaHora) {
    const fechaTurno = new Date(input.turnoFechaHora);
    if (fechaTurno < ahora) {
      turnoVencido = true;
      color = "ROJO";
      motivo = "turno_vencido";
    }
  }

  const result: OrdenMedicaColorResult = {
    color,
    unidad: "horas",
    valor: horas,
    motivo,
    label: null,
    turnoVencido,
  };
  result.label = formatOrdenMedicaSlaLabel(result);
  return result;
}
