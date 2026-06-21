import { createHash } from "crypto";

export type HifParte = { rol: string; nombre: string };

export type ParsedMovimiento = {
  id: string;
  expedienteId: string;
  fecha: string;
  tipo: string;
  detalle: string;
  texto: string;
  raw: Record<string, unknown>;
};

const JURISDICCION_FUERO: Record<string, string> = {
  CIV: "Civil",
  COM: "Comercial",
  LAB: "Laboral",
  CAF: "CAF",
  PEN: "Penal",
  TRAB: "Trabajo",
};

export function mapJurisdiccionToFuero(jurisdiccion: string): string {
  const key = jurisdiccion.trim().toUpperCase();
  return JURISDICCION_FUERO[key] ?? jurisdiccion.trim();
}

function cleanDemandadoNombre(nombre: string): string {
  return nombre.replace(/\s+[Yy]\s+OTROS?\s*$/i, "").trim();
}

export function parsePartesFromCaratula(caratula: string): HifParte[] {
  const trimmed = caratula.trim();
  if (!trimmed) return [];

  const actorLabelMatch = trimmed.match(
    /^ACTOR:\s*(.+?)\s+[Cc]\/\s+(.+?)(?:\s+[Ss]\/|\s*$)/i
  );
  if (actorLabelMatch) {
    return [
      { rol: "Actor", nombre: actorLabelMatch[1].trim() },
      { rol: "Demandado", nombre: cleanDemandadoNombre(actorLabelMatch[2]) },
    ];
  }

  const standardMatch = trimmed.match(/^(.+?)\s+[Cc]\/\s+(.+?)\s+[Ss]\//i);
  if (standardMatch) {
    return [
      { rol: "Actor", nombre: standardMatch[1].trim() },
      { rol: "Demandado", nombre: cleanDemandadoNombre(standardMatch[2]) },
    ];
  }

  const contraMatch = trimmed.match(/^(.+?)\s+contra\s+(.+?)(?:\s+[Ss]\/|\s*$)/i);
  if (contraMatch) {
    return [
      { rol: "Actor", nombre: contraMatch[1].trim() },
      { rol: "Demandado", nombre: cleanDemandadoNombre(contraMatch[2]) },
    ];
  }

  const cSlashOnly = trimmed.match(/^(.+?)\s+[Cc]\/\s+(.+)$/i);
  if (cSlashOnly) {
    return [
      { rol: "Actor", nombre: cSlashOnly[1].trim() },
      { rol: "Demandado", nombre: cleanDemandadoNombre(cSlashOnly[2]) },
    ];
  }

  const incidentMatch = trimmed.match(
    /ACTOR\s*:\s*([^.]+?)\s*DEMANDADO\s*:\s*(.+?)(?:\s+S\/|$)/i
  );
  if (incidentMatch) {
    return [
      { rol: "Actor", nombre: incidentMatch[1].trim() },
      { rol: "Demandado", nombre: cleanDemandadoNombre(incidentMatch[2]) },
    ];
  }

  return [];
}

export function parseSecretariaFromJuzgado(juzgado: string | null | undefined): string | null {
  if (!juzgado?.trim()) return null;
  const match = /SECRETAR[ÍI]A\s*N[°º]?\s*(\d+)/i.exec(juzgado);
  if (!match) return null;
  return `Secretaría Nº ${match[1]}`;
}

export function extractAnoFromNumero(numero: string): number | null {
  const match = /\/(\d{4})(?:\/\d+)?$/.exec(numero.trim());
  if (!match) return null;
  const year = parseInt(match[1], 10);
  return Number.isNaN(year) ? null : year;
}

export function parseDdMmYyyyToIso(fecha: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(fecha.trim());
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = new Date(Date.UTC(year, month - 1, day)).toISOString();
  return iso;
}

export function parseFechaToIso(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const fromSlash = parseDdMmYyyyToIso(trimmed);
  if (fromSlash) return fromSlash;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function colsHaveTipoActuacion(cols: unknown[]): boolean {
  return cols.some((col) => /^Tipo\s+actuacion:/i.test(String(col).trim()));
}

function extractFromCols(cols: string[]): {
  fecha: string | null;
  tipo: string | null;
  detalle: string | null;
  texto: string;
} {
  let fecha: string | null = null;
  let tipo: string | null = null;
  let detalle: string | null = null;
  const textoParts: string[] = [];

  for (const col of cols) {
    const colStr = String(col).trim();
    if (!colStr || colStr === "Descargar Ver") continue;

    const fechaMatch = colStr.match(/^Fecha:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (fechaMatch && !fecha) {
      fecha = parseDdMmYyyyToIso(fechaMatch[1]);
    }

    const tipoMatch = colStr.match(/^Tipo\s+actuacion:\s*(.+)$/i);
    if (tipoMatch && !tipo) {
      tipo = tipoMatch[1].trim();
    }

    const detalleMatch = colStr.match(/^Detalle:\s*(.+)$/i);
    if (detalleMatch && !detalle) {
      detalle = detalleMatch[1].trim();
    }

    textoParts.push(colStr);
  }

  return { fecha, tipo, detalle, texto: textoParts.join(" | ") };
}

function movimientoId(
  expedienteId: string,
  fechaIso: string,
  tipo: string,
  detalle: string
): string {
  return createHash("sha256")
    .update(`${expedienteId}:${fechaIso}:${tipo}:${detalle}`)
    .digest("hex")
    .substring(0, 16);
}

export function parseMovimientoFromJsonb(
  mov: unknown,
  expedienteId: string
): ParsedMovimiento | null {
  if (!mov || typeof mov !== "object") return null;

  const record = mov as Record<string, unknown>;
  const cols = Array.isArray(record.cols) ? record.cols.map(String) : [];
  const tipoDirect = record.tipo != null ? String(record.tipo).trim() : "";

  if (!tipoDirect && (!cols.length || !colsHaveTipoActuacion(cols))) {
    return null;
  }

  const parsed = extractFromCols(cols);
  const tipo = tipoDirect || parsed.tipo || "";
  const detalle = parsed.detalle || "";
  const fecha = parsed.fecha;

  if (!fecha || !tipo) return null;

  const raw: Record<string, unknown> = {
    ...(record.tipo != null ? { tipo: record.tipo } : {}),
    ...(cols.length ? { cols } : {}),
  };

  return {
    id: movimientoId(expedienteId, fecha, tipo, detalle),
    expedienteId,
    fecha,
    tipo,
    detalle,
    texto: parsed.texto,
    raw,
  };
}

export function parseAllMovimientos(
  movimientos: unknown,
  expedienteId: string
): ParsedMovimiento[] {
  if (!Array.isArray(movimientos)) return [];

  const parsed = movimientos
    .map((mov) => parseMovimientoFromJsonb(mov, expedienteId))
    .filter((mov): mov is ParsedMovimiento => mov !== null);

  parsed.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return parsed;
}

export function findUltimoMovimiento(
  movimientos: unknown,
  expedienteId: string
): ParsedMovimiento | null {
  const all = parseAllMovimientos(movimientos, expedienteId);
  return all[0] ?? null;
}
