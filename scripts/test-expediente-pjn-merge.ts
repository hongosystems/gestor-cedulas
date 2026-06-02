/**
 * Verificación del merge (caso 35586/2025).
 * Uso: npx tsx scripts/test-expediente-pjn-merge.ts
 */

import {
  parseExpedienteFromNumero,
  matchKeyFromParts,
  mergeLocalsWithPjnFavoritos,
  isExpedientePjnMergeEnabled,
} from "../lib/expediente-pjn-merge";

function ddmmaaaaToISO(ddmm: string | null): string | null {
  if (!ddmm?.trim()) return null;
  const parts = ddmm.trim().split("/");
  if (parts.length !== 3) return null;
  const [dia, mes, anio] = parts.map((p) => parseInt(p, 10));
  if ([dia, mes, anio].some((n) => isNaN(n))) return null;
  return new Date(anio, mes - 1, dia).toISOString();
}

const parts = parseExpedienteFromNumero("35586/2025");
console.log("parse 35586/2025:", parts);
console.log("match key:", parts ? matchKeyFromParts(parts) : null);
console.log("merge enabled:", isExpedientePjnMergeEnabled());

const locals = [
  {
    id: "local-1",
    numero_expediente: "35586/2025",
    caratula: "BARRIONUEVO c/ VARGAS",
    juzgado: null,
    observaciones: null,
    fecha_ultima_modificacion: "2026-02-10T00:00:00.000Z",
  },
];

const favoritos = [
  {
    id: "pjn-uuid-1",
    jurisdiccion: "CIV",
    numero: "035586",
    anio: 2025,
    caratula: "BARRIONUEVO c/ VARGAS",
    juzgado: "JUZGADO CIVIL 55",
    fecha_ultima_carga: "07/05/2026",
    observaciones: "Tipo actuacion: MOVIMIENTO\nDetalle: EN LETRA",
  },
];

const { mergedLocals, unmatchedFavoritos, mergedCount } = mergeLocalsWithPjnFavoritos(
  locals,
  favoritos,
  { ddmmaaaaToISO }
);

console.log("\nmergedCount:", mergedCount);
console.log("merged local juzgado:", mergedLocals[0].juzgado);
console.log("merged local observaciones:", mergedLocals[0].observaciones);
console.log("merged local fecha ISO:", mergedLocals[0].fecha_ultima_modificacion);
console.log("unmatched favoritos:", unmatchedFavoritos.length);

if (mergedCount !== 1) {
  console.error("FAIL: se esperaba 1 merge");
  process.exit(1);
}
if (!mergedLocals[0].juzgado?.includes("55")) {
  console.error("FAIL: juzgado no rellenado");
  process.exit(1);
}
if (unmatchedFavoritos.length !== 0) {
  console.error("FAIL: favorito debería consumirse (sin duplicado)");
  process.exit(1);
}

console.log("\nOK — merge 35586/2025");
