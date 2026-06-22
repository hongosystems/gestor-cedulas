export function normaliza(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const RE_FIJACION = /\bSE\s+FIJA\s+ANTICIPO\s+(?:PARA|DE)\s+GASTOS\b/;
const RE_AMPLIO = /\bANTICIPO\s+(?:PARA|DE)\s+GASTOS\b/;
const RE_FIJA = /\bFIJ(?:A|O|ASE|ESE)\b|\bSE\s+FIJA\b/;
const RE_MONTO = /\$\s?\d/;
const RE_463 = /\bART(?:\.|ICULO)?\s*463\b/;
const RE_SOLICITA = /\b(?:SOLICITA|SOLICITUD|COLICITA|PIDE|REQUIERE)\b/;
const RE_FALSO =
  /(?:BENEFICIO\s+DE\s+LITIGAR\s+SIN\s+GASTOS|\bSIN\s+GASTOS\b|GASTOS\s+CAUSIDICOS|\bCOSTAS\b|\bPLANILLA\b)/;
const RE_DESIST = /\bTENGASE\s+POR\s+DESISTID/;

export type FijacionGastosResult = {
  match: boolean;
  regla?: string;
  score?: number;
  bajaConfianza?: boolean;
};

export function esFijacionGastos(
  detalle: string,
  tipo = ""
): FijacionGastosResult {
  const t = normaliza(detalle);
  if (RE_FALSO.test(t) || RE_DESIST.test(t)) return { match: false };
  const escrito = /ESCRITO\s+AGREGADO/.test(normaliza(tipo));
  if (RE_FIJACION.test(t) && !RE_SOLICITA.test(t)) {
    return { match: true, regla: "fijacion_directa", score: 3, bajaConfianza: escrito };
  }
  if (
    RE_AMPLIO.test(t) &&
    !RE_SOLICITA.test(t) &&
    (RE_FIJA.test(t) || RE_MONTO.test(t) || RE_463.test(t))
  ) {
    return { match: true, regla: "amplio_con_senal", score: 2, bajaConfianza: escrito };
  }
  return { match: false };
}
