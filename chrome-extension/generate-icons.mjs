/**
 * Genera iconos PNG mínimos (misma imagen 1x1 en tres tamaños).
 * Uso: node generate-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const iconsDir = path.join(__dirname, "icons");
fs.mkdirSync(iconsDir, { recursive: true });
for (const s of [16, 48, 128]) {
  fs.writeFileSync(path.join(iconsDir, `icon${s}.png`), png);
}
console.log("OK:", path.join(iconsDir, "icon{16,48,128}.png"));
