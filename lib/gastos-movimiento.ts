import { createHash } from "crypto";
import { esFijacionGastos, normaliza } from "@/lib/gastos-detect";

export type GastosMovimientoParsed = {
  fecha: string | null;
  tipo: string;
  detalle: string;
  fs: string | null;
  match: ReturnType<typeof esFijacionGastos>;
};

function extractFsFromCols(cols: string[]): string | null {
  const joined = cols.join(" ");
  const fsExplicit = joined.match(/\bfs\.?\s*(\d{1,5}\/\d{1,5})\b/i);
  if (fsExplicit) return fsExplicit[1];
  for (const m of joined.matchAll(/\b(\d{1,5})\/(\d{1,5})\b/g)) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 31 || b > 31) return `${m[1]}/${m[2]}`;
  }
  return null;
}

export function parseColsFromMovimiento(mov: unknown): {
  fecha: string | null;
  tipo: string;
  detalle: string;
  fs: string | null;
  cols: string[];
} {
  const record =
    mov && typeof mov === "object" ? (mov as Record<string, unknown>) : {};
  const cols = Array.isArray(record.cols) ? record.cols.map(String) : [];
  const tipoDirect = record.tipo != null ? String(record.tipo).trim() : "";

  let fecha: string | null = null;
  let tipo = tipoDirect;
  let detalle =
    record.Detalle != null
      ? String(record.Detalle).trim()
      : record.detalle != null
        ? String(record.detalle).trim()
        : "";

  for (const col of cols) {
    const colStr = col.trim();
    if (!colStr || colStr === "Descargar Ver") continue;

    const fechaMatch = colStr.match(/^Fecha:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (fechaMatch && !fecha) fecha = fechaMatch[1];

    const tipoMatch = colStr.match(/^Tipo\s+actuacion:\s*(.+)$/i);
    if (tipoMatch && !tipo) tipo = tipoMatch[1].trim();

    const detalleMatch = colStr.match(/^Detalle:\s*(.+)$/i);
    if (detalleMatch && !detalle) detalle = detalleMatch[1].trim();
  }

  return { fecha, tipo, detalle, fs: extractFsFromCols(cols), cols };
}

export function detectGastosInMovimiento(mov: unknown): GastosMovimientoParsed | null {
  const parsed = parseColsFromMovimiento(mov);
  if (!parsed.detalle) return null;
  const match = esFijacionGastos(parsed.detalle, parsed.tipo);
  if (!match.match) return null;
  return { ...parsed, match };
}

export function buildGastosDedupeKey(parts: {
  jurisdiccion: string;
  numero: string;
  anio: string;
  fs: string | null;
  fecha: string | null;
  detalle: string;
}): string {
  const payload = [
    parts.jurisdiccion,
    parts.numero,
    parts.anio,
    parts.fs || "",
    parts.fecha || "",
    normaliza(parts.detalle),
  ].join("|");
  return createHash("sha1").update(payload).digest("hex");
}
