/**
 * Extracción específica del destinatario institucional para OFICIOS judiciales,
 * pensada como complemento (no reemplazo) de la respuesta de GPT Vision dentro
 * del flujo de auditoría documental.
 *
 * Heurística regex sobre texto plano:
 *   1) Busca un prefijo del tipo
 *      "Al SR. DIRECTOR del/de la/de", "Al DIRECTOR ...",
 *      "Al Señor Director", "Al Director", "Al DR.", "Al Sr.".
 *   2) Devuelve el bloque institucional inmediatamente posterior:
 *      el resto del renglón (si quedó algo después del prefijo) más las
 *      siguientes 1–3 líneas no vacías, hasta encontrar una señal de
 *      dirección (Av, Calle, código postal, "calle + altura", etc.).
 *   3) Concatena con un solo espacio, elimina espacios dobles y saltos de
 *      línea, preservando mayúsculas/minúsculas originales.
 *
 * Esta función es PURA: no toca `cedulas`, ni OCR productivo, ni PJN, ni
 * Storage. Su único uso previsto es el orquestador
 * `obtenerClasificacionAuditoria` en `lib/auditoria-tipo-documento-pdf.ts`.
 */

// ─── Prefijos detectables ────────────────────────────────────────────────────
//
// Cada entrada captura en grupo 1 el "resto" del renglón posterior al prefijo
// (puede estar vacío si el prefijo es la línea completa).
//
// Orden importante: lo más específico primero (DIRECTOR antes de SR./DR. genérico).
const PREFIJOS_DESTINATARIO: readonly RegExp[] = [
  // "Al SR. DIRECTOR (del|de la|de)" — con o sin punto en SR/Sra/Sr.
  /^\s*Al\s+(?:SR\.?|Sra\.?|Sr\.?)\s+(?:DIRECTOR|Director|DIRECTORA|Directora)(?:\s+(?:del|de\s+la|de))?\b\s*(.*)$/i,
  // "Al Señor Director" / "Al Señora Directora" (con tilde o sin)
  /^\s*Al\s+Se(?:ñ|n)ora?\s+(?:Director|DIRECTOR|Directora|DIRECTORA)(?:\s+(?:del|de\s+la|de))?\b\s*(.*)$/i,
  // "Al DIRECTOR (del|de la|de)" sin SR./Señor previo
  /^\s*Al\s+(?:DIRECTOR|Director|DIRECTORA|Directora)(?:\s+(?:del|de\s+la|de))?\b\s*(.*)$/i,
  // "Al DR." / "Al Dr." / "Al Dra."
  /^\s*Al\s+(?:DR\.?|Dr\.?|Dra\.?|DRA\.?)\b\s*(.*)$/i,
  // "Al Sr." / "Al SR." (último, por amplitud — solo si no matchearon los anteriores)
  /^\s*Al\s+(?:SR\.?|Sr\.?|Sra\.?|SRA\.?)\b\s*(.*)$/i,
];

// ─── Detección de líneas de dirección (señales de corte) ─────────────────────

const RE_AVENIDA = /^(?:Av\.?|Avda\.?|Avenida|Calle|Ruta|Pasaje|Diagonal)\b/i;
const RE_PROVINCIA = /\b(?:Provincia|Pcia\.?)\b/i;
const RE_BUENOS_AIRES = /\bBuenos\s+Aires\b/i;
// Código postal argentino: 4 dígitos opcionalmente con letra al inicio (B1650, B1754ABC).
const RE_CP_ARG = /\b[A-Z]\d{4}[A-Z]{0,3}\b/;
const RE_SD_SOLO = /^S\/?D\.?$/i;
const RE_CP_NUM = /\bC\.?P\.?\b\s*\d/i;
// "Palabra ... 123" — calle + altura típica.
const RE_CALLE_ALTURA =
  /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ.][A-Za-zÁÉÍÓÚÜÑáéíóúüñ.,\- ]*\s+\d{1,5}\s*\.?$/;

function esLineaDireccion(linea: string): boolean {
  const t = linea.trim();
  if (t.length === 0) return false;
  if (RE_AVENIDA.test(t)) return true;
  if (RE_PROVINCIA.test(t)) return true;
  if (RE_BUENOS_AIRES.test(t)) return true;
  if (RE_SD_SOLO.test(t)) return true;
  if (RE_CP_NUM.test(t)) return true;
  if (RE_CP_ARG.test(t)) return true;
  if (RE_CALLE_ALTURA.test(t)) return true;
  return false;
}

// ─── Validación del resultado final ──────────────────────────────────────────
//
// Si después de toda la extracción el resultado normalizado coincide con una
// palabra que solo es un rótulo del prefijo (SR, SRA, DIRECTOR, AL, SEÑOR, etc.),
// no es un destinatario válido y devolvemos null.

const IGNORADOS_EXACTOS: ReadonlySet<string> = new Set<string>([
  "SR", "SR.", "SRA", "SRA.",
  "DIRECTOR", "DIRECTORA",
  "DEL", "DE LA", "DE", "AL",
  "SEÑOR", "SEÑORA", "SENOR", "SENORA",
  "DR", "DR.", "DRA", "DRA.",
]);

function esResultadoIgnorado(s: string): boolean {
  const norm = s.toUpperCase().replace(/\s+/g, " ").trim();
  if (norm.length < 3) return true;
  return IGNORADOS_EXACTOS.has(norm);
}

// ─── Limpieza final del destinatario ────────────────────────────────────────

function limpiarDestinatario(s: string): string {
  return s
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Match de prefijo en una línea ──────────────────────────────────────────

type MatchPrefijo = { resto: string };

function matchPrefijo(linea: string): MatchPrefijo | null {
  for (const re of PREFIJOS_DESTINATARIO) {
    const m = linea.match(re);
    if (m) return { resto: m[1] ?? "" };
  }
  return null;
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Extrae el destinatario institucional de un OFICIO judicial a partir del
 * texto plano. Devuelve null si no detecta un patrón válido.
 *
 * Reglas:
 *  - Busca el primer prefijo detectable; toma el resto del mismo renglón
 *    (si quedó algo) + hasta 3 líneas siguientes no vacías como bloque
 *    institucional.
 *  - Corta ante una línea que parece dirección (Av/Avenida/Calle/CP/
 *    Provincia/Buenos Aires/calle + altura).
 *  - Concatena con un espacio, colapsa espacios y saltos de línea, preserva
 *    mayúsculas/minúsculas del input.
 *  - Si el resultado es un rótulo vacío (SR, DIRECTOR, AL, …) devuelve null
 *    y sigue buscando.
 *
 * @param texto Texto plano (puede contener saltos de línea).
 */
export function extraerDestinatarioOficio(texto: string): string | null {
  if (typeof texto !== "string") return null;
  if (texto.trim().length === 0) return null;

  const lineas = texto.split(/\r?\n/);

  const MAX_LINEAS_INSTITUCION = 3;

  for (let i = 0; i < lineas.length; i++) {
    const match = matchPrefijo(lineas[i] ?? "");
    if (!match) continue;

    const partes: string[] = [];

    const resto = (match.resto ?? "").trim();
    if (resto.length > 0 && !esLineaDireccion(resto)) {
      partes.push(resto);
    }

    for (let j = i + 1; j < lineas.length; j++) {
      const candidato = (lineas[j] ?? "").trim();
      if (candidato.length === 0) {
        // Salto de párrafo: si ya tenemos algo, terminamos; si no, seguimos.
        if (partes.length > 0) break;
        continue;
      }
      if (esLineaDireccion(candidato)) break;
      // Si la línea trae otro prefijo "Al ...", probablemente es otra sección.
      if (matchPrefijo(candidato)) break;
      partes.push(candidato);
      if (partes.length >= MAX_LINEAS_INSTITUCION) break;
    }

    if (partes.length === 0) continue;
    const destinatario = limpiarDestinatario(partes.join(" "));
    if (destinatario.length === 0) continue;
    if (esResultadoIgnorado(destinatario)) continue;
    return destinatario;
  }

  return null;
}

/**
 * Aplica `extraerDestinatarioOficio` a un set de páginas con prioridad:
 *
 *    página 2 (idx 1) → página 1 (idx 0) → página 3 (idx 2).
 *
 * Solo se consideran las primeras 3 páginas; cualquier página adicional se
 * ignora. Devuelve el primer match no-null según el orden.
 */
export function extraerDestinatarioOficioDePaginas(
  paginas: readonly string[]
): string | null {
  if (!Array.isArray(paginas)) return null;
  if (paginas.length === 0) return null;
  const orden: readonly number[] = [1, 0, 2];
  for (const idx of orden) {
    if (idx >= paginas.length) continue;
    const pagina = paginas[idx];
    if (typeof pagina !== "string" || pagina.trim().length === 0) continue;
    const r = extraerDestinatarioOficio(pagina);
    if (r) return r;
  }
  return null;
}
