/**
 * Verifica detección Prueba/Pericia tras cambios de patrones.
 * Uso: npx tsx scripts/check-prueba-pericia-detect.ts
 */
import { tienePruebaPericia } from "../lib/prueba-pericia-detect";

const samples: Record<string, string> = {
  "88757": "PRUEBA PENDIENTE.",
  "12917": "PRUEBA: CLAUSURA. AUTOS PARA ALEGAR (ART. 482)",
  "4141": "SE REQUIERE AL PERITO MEDICO FIJAR NUEVA FECHA DE REVISACION AL ACTOR",
  "101088": "HÁGASE SABER AL PERITO MÉDICO LA PROPUESTA EFECTUADA",
  "12923": "AUTO DE APERTURA A PRUEBA",
  "87911": "CERTIFICADO DE PRUEBA",
  "92683": "PERITO MÉDICO OCCHIONER, POR SÍ, CONTESTA TRASLADO DEL 21/5/2026",
};

let failed = 0;
for (const [label, detalle] of Object.entries(samples)) {
  const ok = tienePruebaPericia([{ Detalle: detalle }]);
  console.log(`${ok ? "OK" : "FAIL"}: ${label}`);
  if (!ok) failed++;
}

if (failed) process.exit(1);
console.log("\nTodas las muestras de patrones pasaron.");
