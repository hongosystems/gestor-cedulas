import {
  clasificarTextoPdf,
  extraerTextoPdfLocal,
  normalizarTextoPdf,
} from "@/lib/auditoria-tipo-documento-pdf";

export type DocTipo = "CEDULA" | "OFICIO";

export type RailwayTryResult = {
  ok: boolean;
  expNro: string | null;
  caratula: string | null;
  tipoDocumento: string | null;
};

/**
 * Misma normalización que el clasificador de auditoría (quita acentos).
 */
export function normalizePdfTextChunk(s: string): string {
  return normalizarTextoPdf(s);
}

/**
 * Por cada página (en orden): OFICIO tiene prioridad sobre CÉDULA en la misma página.
 */
export function detectTipoFromPageTexts(pageTexts: string[]): DocTipo | null {
  for (const raw of pageTexts) {
    const n = normalizarTextoPdf(raw);
    if (!n) continue;

    const hasOficio = /\bOFICIO\b/.test(n);
    const hasCedula =
      /\bCEDULA\b/.test(n) || /\bCEDULA\s+DE\s+NOTIFICACION\b/.test(n);

    if (hasOficio) return "OFICIO";
    if (hasCedula) return "CEDULA";
  }
  return null;
}

/** Scoring de patrones sobre las primeras páginas (pdf-parse). */
export async function clasificarTipoDesdePdfBuffer(
  buf: Buffer,
  maxPages = 4
): Promise<DocTipo | null> {
  const ext = await extraerTextoPdfLocal(buf, maxPages);
  if (!ext.ok) return null;
  const r = clasificarTextoPdf({ paginas: ext.paginas });
  if (r.clasificacion === "INDETERMINADO") return null;
  return r.clasificacion;
}

function headerToTipo(header: string | null | undefined): DocTipo | null {
  const t = String(header || "")
    .trim()
    .toUpperCase();
  if (t === "OFICIO") return "OFICIO";
  if (t === "CEDULA") return "CEDULA";
  return null;
}

export type RailwayResolved = {
  /** null = Railway extrajo datos pero el tipo no es confiable; el usuario debe elegir. */
  tipo: DocTipo | null;
  autoDetected: boolean;
  expNro: string | null;
  caratula: string | null;
};

/**
 * Combina respuestas de /procesar y /procesar-oficio sin asumir CEDULA cuando
 * solo el endpoint de cédula responde OK (bug histórico de oficios).
 *
 * @param textHint - heurística local o scoring de patrones (prioridad media)
 */
export function resolveTipoFromRailwayAttempts(
  ced: RailwayTryResult,
  ofi: RailwayTryResult,
  textHint: DocTipo | null
): RailwayResolved | null {
  const headerCed = headerToTipo(ced.tipoDocumento);
  const headerOfi = headerToTipo(ofi.tipoDocumento);

  if (ofi.ok && !ced.ok) {
    return {
      tipo: headerOfi ?? "OFICIO",
      autoDetected: true,
      expNro: ofi.expNro,
      caratula: ofi.caratula,
    };
  }

  if (ced.ok && !ofi.ok) {
    if (headerCed) {
      return {
        tipo: headerCed,
        autoDetected: true,
        expNro: ced.expNro,
        caratula: ced.caratula,
      };
    }
    if (textHint === "OFICIO" || textHint === "CEDULA") {
      return {
        tipo: textHint,
        autoDetected: true,
        expNro: ced.expNro,
        caratula: ced.caratula,
      };
    }
    // Sin header ni hint: no asumir CEDULA (oficios escaneados suelen caer acá).
    return {
      tipo: null,
      autoDetected: false,
      expNro: ced.expNro,
      caratula: ced.caratula,
    };
  }

  if (ced.ok && ofi.ok) {
    if (textHint === "CEDULA" || textHint === "OFICIO") {
      const pickCed = textHint === "CEDULA";
      return {
        tipo: textHint,
        autoDetected: true,
        expNro: pickCed ? ced.expNro ?? ofi.expNro : ofi.expNro ?? ced.expNro,
        caratula: pickCed ? ced.caratula ?? ofi.caratula : ofi.caratula ?? ced.caratula,
      };
    }
    if (headerCed === "CEDULA" && headerOfi !== "OFICIO") {
      return {
        tipo: "CEDULA",
        autoDetected: true,
        expNro: ced.expNro ?? ofi.expNro,
        caratula: ced.caratula ?? ofi.caratula,
      };
    }
    if (headerOfi === "OFICIO" && headerCed !== "CEDULA") {
      return {
        tipo: "OFICIO",
        autoDetected: true,
        expNro: ofi.expNro ?? ced.expNro,
        caratula: ofi.caratula ?? ced.caratula,
      };
    }
    // Ambos endpoints OK pero tipos en conflicto (p. ej. cédula con resolución embebida).
    return {
      tipo: null,
      autoDetected: false,
      expNro: ced.expNro ?? ofi.expNro,
      caratula: ced.caratula ?? ofi.caratula,
    };
  }

  return null;
}
