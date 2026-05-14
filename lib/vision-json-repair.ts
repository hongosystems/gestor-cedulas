/**
 * Repara JSON típico roto por LLMs en respuestas Vision (p. ej. falta de coma entre
 * `"valor_largo"\n  "siguiente_clave"`). Pensado para copiar al servicio OCR en Railway
 * que parsea la salida de GPT-4o.
 */

function stripMarkdownJsonFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  return s.trim();
}

/** Primer objeto `{ ... }` balanceando llaves (string-aware básico). */
function extractBalancedJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Inserta comas faltantes cuando un string JSON termina en `"` y en la siguiente línea
 * empieza otro `"clave"`. En JSON válido no puede haber salto de línea literal dentro
 * de un string; si aparece, casi siempre es cierre + nueva propiedad sin coma.
 */
export function insertMissingCommasBetweenQuotedLines(json: string): string {
  return json.replace(/("(?:\\.|[^"\\])*")\s*\r?\n\s*"/g, "$1,\n\"");
}

export function repairVisionOcrJsonText(raw: string): string {
  const unfenced = stripMarkdownJsonFence(raw);
  const obj = extractBalancedJsonObject(unfenced) ?? unfenced;
  return insertMissingCommasBetweenQuotedLines(obj);
}

/** Parsea JSON de Vision con una pasada de reparación heurística. */
export function parseVisionOcrJson(raw: string): unknown {
  const candidate = extractBalancedJsonObject(stripMarkdownJsonFence(raw)) ?? stripMarkdownJsonFence(raw);
  try {
    return JSON.parse(candidate);
  } catch {
    const repaired = repairVisionOcrJsonText(raw);
    return JSON.parse(repaired);
  }
}
