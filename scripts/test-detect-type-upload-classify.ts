/**
 * npx tsx scripts/test-detect-type-upload-classify.ts
 */
import { resolveTipoFromRailwayAttempts } from "../lib/detect-type-upload-classify";
import { gptTipoEsDefinitivo } from "../lib/gpt-vision-tipo-documento";

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

// Sin hint → no asumir tipo (usuario elige); conservar exp/carátula
const soloCedulaSinHint = resolveTipoFromRailwayAttempts(
  { ok: true, expNro: "1/2024", caratula: "X", tipoDocumento: null },
  empty,
  null
);
assert(soloCedulaSinHint?.tipo === null, "solo /procesar sin hint → tipo null");
assert(soloCedulaSinHint?.autoDetected === false, "solo /procesar sin hint → no auto");
assert(soloCedulaSinHint?.expNro === "1/2024", "solo /procesar sin hint → conserva exp");

// Con hint CEDULA explícito → CEDULA
const soloCedulaConHint = resolveTipoFromRailwayAttempts(
  { ok: true, expNro: "2/2024", caratula: "Y", tipoDocumento: null },
  empty,
  "CEDULA"
);
assert(soloCedulaConHint?.tipo === "CEDULA", "solo /procesar + hint CEDULA → CEDULA");

// Ambos OK sin hint → ambiguo (no default OFICIO)
const ambos = resolveTipoFromRailwayAttempts(
  { ok: true, expNro: "1/2024", caratula: "A", tipoDocumento: null },
  { ok: true, expNro: "1/2024", caratula: "B", tipoDocumento: null },
  null
);
assert(ambos?.tipo === null, "ambos endpoints OK sin hint → tipo null");
assert(ambos?.autoDetected === false, "ambos OK sin hint → no auto");

// Ambos OK + hint CEDULA
const ambosCed = resolveTipoFromRailwayAttempts(
  { ok: true, expNro: "1/2024", caratula: "A", tipoDocumento: null },
  { ok: true, expNro: "1/2024", caratula: "B", tipoDocumento: null },
  "CEDULA"
);
assert(ambosCed?.tipo === "CEDULA", "ambos OK + hint CEDULA → CEDULA");

// Ambos OK + headers en conflicto → ambiguo
const ambosConflicto = resolveTipoFromRailwayAttempts(
  {
    ok: true,
    expNro: "1/2024",
    caratula: "A",
    tipoDocumento: "CEDULA",
  },
  {
    ok: true,
    expNro: "1/2024",
    caratula: "B",
    tipoDocumento: "OFICIO",
  },
  null
);
assert(ambosConflicto?.tipo === null, "ambos OK headers CEDULA+OFICIO → tipo null");

// Solo oficio endpoint
const soloOfi = resolveTipoFromRailwayAttempts(
  empty,
  { ok: true, expNro: "9/2023", caratula: "Z", tipoDocumento: null },
  null
);
assert(soloOfi?.tipo === "OFICIO", "solo /procesar-oficio → OFICIO");

assert(gptTipoEsDefinitivo("CEDULA", 0.6), "gptTipoEsDefinitivo CEDULA 0.6");
assert(!gptTipoEsDefinitivo("CEDULA", 0.4), "gptTipoEsDefinitivo CEDULA 0.4 no");
assert(!gptTipoEsDefinitivo("INDETERMINADO", 1), "gptTipoEsDefinitivo INDETERMINADO no");

console.log(process.exitCode === 1 ? "FALLÓ" : "OK");
