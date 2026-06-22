/**
 * Validación de reglas de detección GASTOS (checklist §11).
 * Uso: npx tsx scripts/check-gastos-detect.ts
 */
import { esFijacionGastos } from "../lib/gastos-detect";

function assert(label: string, cond: boolean, detail?: string) {
  if (!cond) {
    console.error(`FAIL: ${label}`, detail || "");
    process.exitCode = 1;
  } else {
    console.log(`OK: ${label}`);
  }
}

const canonico =
  "POR ACEPTADO EL CARGO. SE FIJA ANTICIPO PARA GASTOS PERITO MEDICO";
const r1 = esFijacionGastos(canonico, "FIRMA DESPACHO");
assert("canónico fijacion_directa", r1.match === true && r1.regla === "fijacion_directa" && r1.score === 3);

const escritoParte =
  "PERITO MEDICO - ACEPTA CARGO - COLICITA ANTICIPO PARA GASTOS";
const r2 = esFijacionGastos(escritoParte, "ESCRITO AGREGADO");
assert("escrito parte no dispara", r2.match === false);

const sinGastos = "SE CONCEDE BENEFICIO DE LITIGAR SIN GASTOS";
const r3 = esFijacionGastos(sinGastos, "FIRMA DESPACHO");
assert("sin gastos excluido", r3.match === false);

const desistido = "TENGASE POR DESISTIDA LA PRUEBA PERICIAL";
const r4 = esFijacionGastos(desistido, "FIRMA DESPACHO");
assert("desistido excluido", r4.match === false);

const conApercibimiento =
  "SE FIJA ANTICIPO PARA GASTOS bajo apercibimiento de tener al interesado por desistido";
const r5 = esFijacionGastos(conApercibimiento, "FIRMA DESPACHO");
assert("fijación con apercibimiento desistido OK", r5.match === true);

if (process.exitCode) {
  console.error("\nAlgunas pruebas fallaron.");
  process.exit(1);
}
console.log("\nTodas las pruebas de detección pasaron.");
