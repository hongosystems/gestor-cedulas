/** Patrones canónicos para detectar Prueba/Pericia en movimientos PJN. */
export const PRUEBA_PERICIA_DETALLE_PATTERNS: RegExp[] = [
  /SE\s+ORDENA.*PERICI/i,
  /ORDENA.*PERICI/i,
  /SOLICITA.*PROVEE.*PRUEBA\s+PERICI/i,
  /PRUEBA\s+PERICIAL/i,
  /PERITO.*ACEPTA\s+(?:EL\s+)?CARGO/i,
  /PERITO.*PRESENTA\s+INFORME/i,
  /PERITO.*FIJA\s+(?:NUEVA\s+)?FECHA/i,
  /PERITO.*INFORMA/i,
  /PERITO.*CITA/i,
  /LLAMA.*PERICI/i,
  /DISPONE.*PERICI/i,
  /TRASLADO.*PERICI/i,
  /PERICI.*M[EÉ]DIC/i,
  /PERICI.*PSICOL/i,
  /PERICI.*CONTAB/i,
  /PERICI.*INGENIER/i,
  /PERICI.*LEGIST/i,
  /ACREDITA.*PERITO/i,
  /ANTICIPO.*PERITO/i,
  /GASTOS.*PERITO/i,
  /HAGASE\s+SABER.*PERITO/i,
  /TENGASE\s+PRESENTE.*PERITO/i,
  /INTIMACION.*PERITO/i,
  /INTIMA.*PERITO/i,
  /SE\s+INTIME.*PERITO/i,
  /PERITO.*ACOMPAÑA/i,
  /PERITO.*ADJUNTA/i,
  /NOTIFIQUESE.*PERITO/i,
  /NOTIFICA.*PERITO/i,
  /HAGASE\s+SABER.*EXPERTA/i,
  /HAGASE\s+SABER.*EXPERTO/i,
  /TENGASE\s+PRESENTE.*EXPERTA/i,
  /TENGASE\s+PRESENTE.*EXPERTO/i,
  /INTIMACION.*EXPERTA/i,
  /INTIMACION.*EXPERTO/i,
  /INTIMA.*EXPERTA/i,
  /INTIMA.*EXPERTO/i,
  /SE\s+INTIME.*EXPERTA/i,
  /SE\s+INTIME.*EXPERTO/i,
  /NOTIFIQUESE.*EXPERTA/i,
  /NOTIFIQUESE.*EXPERTO/i,
  /NOTIFICA.*EXPERTA/i,
  /NOTIFICA.*EXPERTO/i,
  /EXPERTA.*ACEPTA\s+(?:EL\s+)?CARGO/i,
  /EXPERTO.*ACEPTA\s+(?:EL\s+)?CARGO/i,
  /EXPERTA.*PRESENTA\s+INFORME/i,
  /EXPERTO.*PRESENTA\s+INFORME/i,
  /EXPERTA.*FIJA\s+(?:NUEVA\s+)?FECHA/i,
  /EXPERTO.*FIJA\s+(?:NUEVA\s+)?FECHA/i,
  /EXPERTA.*INFORMA/i,
  /EXPERTO.*INFORMA/i,
  /EXPERTA.*CITA/i,
  /EXPERTO.*CITA/i,
  /EXPERTA.*ACOMPAÑA/i,
  /EXPERTO.*ACOMPAÑA/i,
  /EXPERTA.*ADJUNTA/i,
  /EXPERTO.*ADJUNTA/i,
  /AGR[EÉ]GUENSE.*ESTUDIOS.*M[EÉ]DICOS.*EXPERTA/i,
  /AGR[EÉ]GUENSE.*ESTUDIOS.*M[EÉ]DICOS.*EXPERTO/i,
  /PRESENTACION\s+DEL\s+INFORME\s+PERICIAL/i,
  /INFORME\s+PERICIAL/i,
  /AUTOS?\s+A\s+PRUEBA/i,
  /SE\s+ABRE\s+LA\s+CAUSA\s+A\s+PRUEBA/i,
  /ABRESE\s+A\s+PRUEBA/i,
  /PROV[EÉ]ASE\s+PRUEBA/i,
  /SE\s+PROVEE\s+LA\s+PRUEBA/i,
  /PUNTOS?\s+DE\s+PERICIA/i,
  /DESIGN[EA]SE\s+(?:EXPERTO|EXPERTA|CONSULTOR|CONSULTORA)/i,
  /TRASLADO\s+DEL\s+INFORME/i,
  // Etapa probatoria documental: certificación de prueba ofrecida
  /SE\s+CERTIFIQUE\s+PRUEBA/i,
  /SOLICITA\s+SE\s+CERTIFIQUE\s+PRUEBA/i,
  /CERTIFIQUEN?\s+(?:LAS\s+)?PRUEBAS?/i,
  /CERTIFICADO\s+DE\s+PRUEBA/i,
  /INFORMESE\s+SOBRE\s+LA\s+PRUEBA/i,
  /PRUEBA\s+PENDIENTE/i,
  /CLAUSURA\s+PRUEBA/i,
  /PRUEBA:\s*CLAUSURA/i,
  /APERTURA\s+A\s+PRUEBA/i,
  /SE\s+REQUIERE\s+AL\s+PERITO/i,
  /PERITO\s+MEDICO\s+PRESENTA\s+ESCRITO/i,
  /PERITO.*CONTESTA\s+TRASLADO/i,
  /DE\s+LA\s+PERICIAL/i,
  /MANIFIESTA.*PERITO/i,
  /SOLICITA\s+A\s+PERITO/i,
];

/** Quita acentos para que HÁGASE/TÉNGASE/MÉDICO matcheen patrones ASCII. */
export function normalizeDetalleForMatch(text: string): string {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractDetalleTextFromMovimiento(mov: Record<string, unknown>): string {
  let detalleText = "";
  const detalleDirectRaw = mov.Detalle ?? mov.detalle;
  if (detalleDirectRaw != null && String(detalleDirectRaw).trim() !== "") {
    detalleText = String(detalleDirectRaw).toUpperCase();
  }

  const cols = mov.cols;
  if ((!detalleText || detalleText.trim().length === 0) && Array.isArray(cols)) {
    for (const col of cols) {
      const colStr = String(col).trim();
      const matchDetalle = colStr.match(/Detalle:\s*(.+)/i);
      if (matchDetalle) {
        detalleText = matchDetalle[1].toUpperCase();
        break;
      }
    }
    if (!detalleText) {
      detalleText = cols.map((col) => String(col)).join(" ").toUpperCase();
    }
  }

  return normalizeDetalleForMatch(detalleText.trim());
}

function normalizeMovimientos(movimientos: unknown): unknown[] | null {
  if (!movimientos) return null;

  let movs: unknown = movimientos;
  if (typeof movimientos === "string") {
    try {
      movs = JSON.parse(movimientos);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(movs)) {
    if (
      typeof movs === "object" &&
      movs !== null &&
      ("cols" in movs || "Detalle" in movs || "detalle" in movs)
    ) {
      return [movs];
    }
    return null;
  }

  return movs;
}

/** True si algún movimiento PJN matchea patrones de Prueba/Pericia o certificación de prueba. */
export function tienePruebaPericia(movimientos: unknown): boolean {
  try {
    const movs = normalizeMovimientos(movimientos);
    if (!movs?.length) return false;

    for (const mov of movs) {
      if (typeof mov !== "object" || mov === null) continue;
      const detalleText = extractDetalleTextFromMovimiento(mov as Record<string, unknown>);
      if (!detalleText) continue;

      for (const patron of PRUEBA_PERICIA_DETALLE_PATTERNS) {
        if (patron.test(detalleText)) return true;
      }
    }

    return false;
  } catch (err) {
    console.warn("[Prueba/Pericia] Error al analizar movimientos:", err);
    return false;
  }
}
