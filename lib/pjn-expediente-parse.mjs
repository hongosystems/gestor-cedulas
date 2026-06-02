/**
 * Parseo de claves PJN (cases.key / favoritos) — versión ESM para scripts Node.
 * Mantener alineado con lib/pjn-expediente-parse.ts
 */

export function normalizeNumeroBase(numero) {
  const t = String(numero).trim();
  const stripped = t.replace(/^0+/, "");
  return stripped || "0";
}

export function normalizeNumeroStorage(numero) {
  const t = String(numero).trim();
  const slashIdx = t.indexOf("/");
  if (slashIdx === -1) return normalizeNumeroBase(t);
  const base = normalizeNumeroBase(t.slice(0, slashIdx));
  const suffix = t.slice(slashIdx + 1).trim();
  return suffix ? `${base}/${suffix}` : base;
}

export function parseExpedienteFromCasesKey(expText) {
  if (!expText?.trim()) return null;
  const text = expText.trim().toUpperCase();

  let match = text.match(/^([A-Z]+)\s+(\d+)\/(\d{4})\/(\d+)\s*$/);
  if (match) {
    const [, jurisdiccion, base, anioStr, incidente] = match;
    const anio = parseInt(anioStr, 10);
    if (isNaN(anio)) return null;
    return {
      jurisdiccion,
      numero: `${normalizeNumeroBase(base)}/${incidente}`,
      anio,
    };
  }

  match = text.match(/^([A-Z]+)\s+(\d+)\/(\d{4})\s*$/);
  if (match) {
    const [, jurisdiccion, numero, anioStr] = match;
    const anio = parseInt(anioStr, 10);
    if (isNaN(anio)) return null;
    return {
      jurisdiccion,
      numero: normalizeNumeroBase(numero),
      anio,
    };
  }

  match = text.match(/\b([A-Z]+)\s+(\d+)\/(\d{4})\/(\d+)\b/);
  if (match) {
    const [, jurisdiccion, base, anioStr, incidente] = match;
    const anio = parseInt(anioStr, 10);
    if (isNaN(anio)) return null;
    return {
      jurisdiccion,
      numero: `${normalizeNumeroBase(base)}/${incidente}`,
      anio,
    };
  }

  match = text.match(/\b([A-Z]+)\s+(\d+)\/(\d{4})\b/);
  if (match) {
    const [, jurisdiccion, numero, anioStr] = match;
    const anio = parseInt(anioStr, 10);
    if (isNaN(anio)) return null;
    return {
      jurisdiccion,
      numero: normalizeNumeroBase(numero),
      anio,
    };
  }

  return null;
}

export function favoritoMatchKey(parts) {
  return `${parts.jurisdiccion}|${normalizeNumeroStorage(parts.numero)}|${parts.anio}`;
}

export function favoritoMatchKeyFromRow(jurisdiccion, numero, anio) {
  return `${jurisdiccion.toUpperCase()}|${normalizeNumeroStorage(numero)}|${anio}`;
}

export function favoritoMatchKeyVariants(parts) {
  const keys = new Set();
  keys.add(favoritoMatchKey(parts));
  if (!parts.numero.includes("/")) {
    keys.add(`${parts.jurisdiccion}|${parts.numero.padStart(6, "0")}|${parts.anio}`);
  }
  return [...keys];
}
