import assert from "node:assert/strict";
import {
  parseExpedienteFromCasesKey,
  favoritoMatchKey,
  normalizeNumeroStorage,
} from "../lib/pjn-expediente-parse";

const principal = parseExpedienteFromCasesKey("CIV 105060/2023");
assert.deepEqual(principal, {
  jurisdiccion: "CIV",
  numero: "105060",
  anio: 2023,
});

const incidente = parseExpedienteFromCasesKey("CIV 105060/2023/1");
assert.deepEqual(incidente, {
  jurisdiccion: "CIV",
  numero: "105060/1",
  anio: 2023,
});

assert.notEqual(
  favoritoMatchKey(principal!),
  favoritoMatchKey(incidente!),
  "principal e incidente deben tener claves distintas"
);

assert.equal(normalizeNumeroStorage("0105060/1"), "105060/1");
assert.equal(normalizeNumeroStorage("105060"), "105060");

console.log("test-pjn-expediente-parse: OK");
