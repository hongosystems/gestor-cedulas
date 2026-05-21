/**
 * Verificación manual de getDescripcionPjn / buildPjnDiligenciamientoPayload.
 * Ejecutar: npx tsx scripts/verify-pjn-payload.ts
 */
import {
  buildPjnDiligenciamientoPayload,
  getDescripcionPjn,
} from "../lib/pjn-payload";

const base = {
  cedulaId: "test-id",
  expNro: "123/2025",
  jurisdiccion: "CIV",
  pdfUrl: "https://example.com/acredita.pdf",
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Caso 1: OFICIO
const oficio = buildPjnDiligenciamientoPayload({
  ...base,
  tipo_documento: "OFICIO",
});
assert(oficio.tipoDocumento === "OFICIO", "tipoDocumento OFICIO");
assert(
  oficio.descripcion === "Acredita Diligenciamiento Oficio",
  "descripcion OFICIO"
);

// Caso 2: CEDULA
const cedula = buildPjnDiligenciamientoPayload({
  ...base,
  tipo_documento: "CEDULA",
});
assert(cedula.tipoDocumento === "CEDULA", "tipoDocumento CEDULA");
assert(
  cedula.descripcion === "Acredita Diligenciamiento Cedula",
  "descripcion CEDULA"
);

// Caso 3: inválidos — no deben construir payload
for (const bad of [null, "", "  ", "OTROS", "OTROS_ESCRITOS"]) {
  let threw = false;
  try {
    getDescripcionPjn(bad);
  } catch {
    threw = true;
  }
  assert(threw, `debe fallar para tipo_documento=${JSON.stringify(bad)}`);
}

console.log("OK: verify-pjn-payload (OFICIO, CEDULA, inválidos)");
