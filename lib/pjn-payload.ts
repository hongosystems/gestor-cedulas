/**
 * Payload y descripción para POST /cargar-pjn (VPS pjn-local).
 * Fuente de verdad: cedulas.tipo_documento (no usar cedulas.tipo).
 */

export function getDescripcionPjn(tipoDocumento: string | null | undefined): string {
  const normalized = String(tipoDocumento || "").trim().toUpperCase();

  if (normalized === "OFICIO") {
    return "Acredita Diligenciamiento Oficio";
  }

  if (normalized === "CEDULA") {
    return "Acredita Diligenciamiento Cedula";
  }

  throw new Error(`tipo_documento inválido para descripción PJN: ${tipoDocumento}`);
}

export function normalizeTipoDocumentoPjn(
  tipo_documento: string | null | undefined
): "OFICIO" | "CEDULA" {
  const normalized = String(tipo_documento || "").trim().toUpperCase();
  if (normalized === "OFICIO" || normalized === "CEDULA") {
    return normalized;
  }
  throw new Error(`tipo_documento inválido para PJN: ${tipo_documento}`);
}

export type PjnCargarPayload = {
  cedulaId: string;
  expNro: string;
  jurisdiccion: string;
  /** Juzgado de la cédula (ej. JUZGADO CIVIL 19) — el VPS lo usa para elegir destinatario en paso 3. */
  juzgado?: string | null;
  pdfUrl: string;
  tipoDocumento: "OFICIO" | "CEDULA";
  descripcion: string;
};

/** Diligenciamiento (acredita): descripción derivada de tipo_documento. */
export function buildPjnDiligenciamientoPayload(input: {
  cedulaId: string;
  expNro: string;
  jurisdiccion: string;
  juzgado?: string | null;
  pdfUrl: string;
  tipo_documento: string | null | undefined;
}): PjnCargarPayload {
  const tipoDocumento = normalizeTipoDocumentoPjn(input.tipo_documento);
  const descripcion = getDescripcionPjn(tipoDocumento);
  return {
    cedulaId: input.cedulaId,
    expNro: input.expNro,
    jurisdiccion: input.jurisdiccion,
    juzgado: input.juzgado?.trim() || null,
    pdfUrl: input.pdfUrl,
    tipoDocumento,
    descripcion,
  };
}

export function logPjnPayload(
  row: { tipo_documento?: string | null },
  payload: PjnCargarPayload
): void {
  console.log("[PJN payload]", {
    cedulaId: payload.cedulaId,
    tipo_documento: row.tipo_documento,
    tipoDocumento: payload.tipoDocumento,
    descripcion: payload.descripcion,
    pdfUrl: payload.pdfUrl,
  });
}

function normalizePjnBase(raw: string): string {
  let u = raw.replace(/\/$/, "");
  u = u.replace(/\/cargar-pjn\/?$/i, "");
  return u;
}

/** Solo VPS local (reiteratorios). */
export function pjnLocalBaseUrl(): string | null {
  const raw = process.env.PJN_LOCAL_URL?.trim();
  if (!raw) return null;
  return normalizePjnBase(raw);
}

/** VPS o Railway para diligenciamiento / cargar-pjn. */
export function pjnVpsBaseUrl(): string | null {
  const raw =
    process.env.PJN_LOCAL_URL?.trim() ||
    process.env.RAILWAY_CARGAR_PJN_URL?.trim() ||
    process.env.RAILWAY_OCR_URL?.trim();
  if (!raw) return null;
  return normalizePjnBase(raw);
}
