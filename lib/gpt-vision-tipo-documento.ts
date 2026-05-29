/**
 * Clasificación CEDULA vs OFICIO con GPT Vision (Responses API + input_file).
 * Usado en subida de archivos y auditoría admin (mismo prompt).
 */

import {
  AUDIT_GPT_TIMEOUT_MS,
  AUDIT_OPENAI_DEFAULT_MODEL,
  createGptVisionClient,
  parsearMaxPages,
  recortarPdfPrimeraPaginas,
  type GptVisionRespuesta,
} from "@/lib/auditoria-tipo-documento-pdf";
import { GPT_TIPO_DOCUMENTO_PROMPT } from "@/lib/gpt-vision-tipo-documento-prompt";

export { GPT_TIPO_DOCUMENTO_PROMPT } from "@/lib/gpt-vision-tipo-documento-prompt";

export type TipoDocumentoClasificado = "CEDULA" | "OFICIO" | "INDETERMINADO";

/** Confianza mínima para marcar autoDetected=true en detect-type-upload. */
export const GPT_TIPO_MIN_CONFIANZA_AUTO = 0.55;

export type ClasificarTipoGptResult =
  | {
      ok: true;
      tipo: TipoDocumentoClasificado;
      confianza: number;
      respuesta: GptVisionRespuesta;
      modelo: string;
      paginas_enviadas: number;
    }
  | { ok: false; error: string };

export type ClasificarTipoGptOptions = {
  maxPages?: number;
  modelo?: string;
  timeoutMs?: number;
};

/**
 * Clasifica un PDF con GPT Vision. No lanza: errores en `{ ok: false }`.
 * Requiere OPENAI_API_KEY en el servidor.
 */
export async function clasificarTipoDocumentoConGptVision(
  buf: Buffer,
  opts: ClasificarTipoGptOptions = {}
): Promise<ClasificarTipoGptResult> {
  const maxPages = parsearMaxPages(opts.maxPages ?? 3);
  const modelo =
    (opts.modelo ?? process.env.AUDIT_OPENAI_MODEL ?? "").trim() ||
    AUDIT_OPENAI_DEFAULT_MODEL;

  const client = createGptVisionClient({
    prompt: GPT_TIPO_DOCUMENTO_PROMPT,
    timeoutMs: opts.timeoutMs ?? AUDIT_GPT_TIMEOUT_MS,
  });
  if (!client) {
    return { ok: false, error: "OPENAI_API_KEY no configurada" };
  }

  const recortado = await recortarPdfPrimeraPaginas(buf, maxPages);
  if (!recortado.ok) {
    return { ok: false, error: `PDF inválido: ${recortado.error}` };
  }

  const gptRes = await client.invocar(recortado.buffer, modelo);
  if (!gptRes.ok) {
    return { ok: false, error: gptRes.error };
  }

  const r = gptRes.respuesta;
  return {
    ok: true,
    tipo: r.tipo_documento,
    confianza: r.confianza,
    respuesta: r,
    modelo: gptRes.modelo,
    paginas_enviadas: recortado.paginas_enviadas,
  };
}

export function gptTipoEsDefinitivo(
  tipo: TipoDocumentoClasificado,
  confianza: number,
  minConfianza = GPT_TIPO_MIN_CONFIANZA_AUTO
): tipo is "CEDULA" | "OFICIO" {
  return (tipo === "CEDULA" || tipo === "OFICIO") && confianza >= minConfianza;
}
