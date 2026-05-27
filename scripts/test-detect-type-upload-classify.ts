/**
 * npx tsx scripts/test-detect-type-upload-classify.ts
 */
import { resolveTipoFromRailwayAttempts } from "../lib/detect-type-upload-classify";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("✘", msg);
    process.exitCode = 1;
  } else {
    console.log("✔", msg);
  }
}

const empty = { ok: false, expNro: null, caratula: null, tipoDocumento: null };

// Oficio que solo pasa /procesar — con hint OFICIO debe quedar OFICIO
const soloCedula = resolveTipoFromRailwayAttempts(
  { ok: true, expNro: "034136/2022", caratula: "X", tipoDocumento: null },
  empty,
  "OFICIO"
);
assert(soloCedula?.tipo === "OFICIO", "solo /procesar + hint OFICIO → OFICIO");

// Sin hint → CEDULA (cédula real)
const soloCedulaSinHint = resolveTipoFromRailwayAttempts(
  { ok: true, expNro: "1/2024", caratula: "X", tipoDocumento: null },
  empty,
  null
);
assert(soloCedulaSinHint?.tipo === "CEDULA", "solo /procesar sin hint → CEDULA");

// Ambos OK → OFICIO por defecto
const ambos = resolveTipoFromRailwayAttempts(
  { ok: true, expNro: "1/2024", caratula: "A", tipoDocumento: null },
  { ok: true, expNro: "1/2024", caratula: "B", tipoDocumento: null },
  null
);
assert(ambos?.tipo === "OFICIO", "ambos endpoints OK → OFICIO");

// Ambos OK + hint CEDULA
const ambosCed = resolveTipoFromRailwayAttempts(
  { ok: true, expNro: "1/2024", caratula: "A", tipoDocumento: null },
  { ok: true, expNro: "1/2024", caratula: "B", tipoDocumento: null },
  "CEDULA"
);
assert(ambosCed?.tipo === "CEDULA", "ambos OK + hint CEDULA → CEDULA");

// Solo oficio endpoint
const soloOfi = resolveTipoFromRailwayAttempts(
  empty,
  { ok: true, expNro: "9/2023", caratula: "Z", tipoDocumento: null },
  null
);
assert(soloOfi?.tipo === "OFICIO", "solo /procesar-oficio → OFICIO");

console.log(process.exitCode === 1 ? "FALLÓ" : "OK");
