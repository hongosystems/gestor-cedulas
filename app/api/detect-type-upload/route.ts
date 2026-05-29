import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  clasificarTipoDesdePdfBuffer,
  detectTipoFromPageTexts,
  normalizePdfTextChunk,
  resolveTipoFromRailwayAttempts,
  type DocTipo,
  type RailwayTryResult,
} from "@/lib/detect-type-upload-classify";
import {
  clasificarTipoDocumentoConGptVision,
  gptTipoEsDefinitivo,
} from "@/lib/gpt-vision-tipo-documento";

export const runtime = "nodejs";
export const maxDuration = 120;

const PDF_CLASSIFY_MAX_PAGES = 4;

function gptVisionHabilitado(): boolean {
  if (process.env.DETECT_TYPE_GPT_VISION?.trim().toLowerCase() === "false") {
    return false;
  }
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function parseGptMaxPages(): number | undefined {
  const raw = process.env.DETECT_TYPE_GPT_MAX_PAGES?.trim();
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function extractPdfPageTextsFirstN(buf: Buffer, maxPages: number): Promise<string[]> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText({ first: maxPages });
    return result.pages.slice(0, maxPages).map((p) => p.text ?? "");
  } finally {
    await parser.destroy();
  }
}

async function detectTipoLocalFromPdfBuffer(buf: Buffer, fileName: string): Promise<DocTipo | null> {
  const name = fileName.toLowerCase();
  try {
    const pageTexts = await extractPdfPageTextsFirstN(buf, PDF_CLASSIFY_MAX_PAGES);
    const fromPages = detectTipoFromPageTexts(pageTexts);
    if (fromPages) return fromPages;
  } catch {
    /* fallback nombre */
  }

  const nameUpper = name.toUpperCase();
  if (/OFICIO/i.test(nameUpper)) return "OFICIO";
  if (/CEDULA/i.test(nameUpper)) return "CEDULA";
  if (/^acredita-/.test(name)) return "OFICIO";
  return null;
}

async function detectTipoLocalFromFile(file: File): Promise<DocTipo | null> {
  const name = (file.name || "").toLowerCase();
  const ext = name.split(".").pop() || "";

  if (ext !== "docx" && ext !== "pdf") {
    const nameUpper = name.toUpperCase();
    if (/OFICIO/i.test(nameUpper)) return "OFICIO";
    if (/CEDULA/i.test(nameUpper)) return "CEDULA";
    return null;
  }

  const buf = Buffer.from(await file.arrayBuffer());

  try {
    if (ext === "docx") {
      const result = await mammoth.extractRawText({ buffer: buf });
      const text = result.value || "";
      if (!text.trim()) {
        const nameUpper = name.toUpperCase();
        if (/OFICIO/i.test(nameUpper)) return "OFICIO";
        if (/CEDULA/i.test(nameUpper)) return "CEDULA";
        return null;
      }
      const normalizedText = normalizePdfTextChunk(text);
      const first500 = normalizedText.substring(0, 500);
      const hasCedula =
        /\bCEDULA\b/.test(first500) || /\bCEDULA\s+DE\s+NOTIFICACION\b/.test(first500);
      const first200 = normalizedText.substring(0, 200);
      const startsWithOficio =
        /^\s*OFICIO\b/.test(normalizedText) || /\bOFICIO\b/.test(first200);
      if (startsWithOficio) return "OFICIO";
      if (hasCedula) return "CEDULA";
      return null;
    }

    if (ext === "pdf") {
      return detectTipoLocalFromPdfBuffer(buf, file.name || "");
    }

    return null;
  } catch {
    const nameUpper = name.toUpperCase();
    if (/OFICIO/i.test(nameUpper)) return "OFICIO";
    if (/CEDULA/i.test(nameUpper)) return "CEDULA";
    return null;
  }
}

async function tryRailwayEndpoint(
  base: string,
  endpoint: string,
  buffer: Buffer,
  pdfFilename: string
): Promise<RailwayTryResult> {
  try {
    const formData = new FormData();
    formData.append(
      "pdf",
      new Blob([new Uint8Array(buffer)], { type: "application/pdf" }),
      pdfFilename
    );

    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(115_000),
    });

    const expNroRaw =
      res.headers.get("X-Exp-Nro") || res.headers.get("x-exp-nro") || "";
    const expNro = expNroRaw.trim() || null;

    let caratula = res.headers.get("X-Caratula") || res.headers.get("x-caratula");
    if (caratula) {
      try {
        caratula = decodeURIComponent(caratula);
      } catch {
        /* keep */
      }
    }

    const tipoDocumento =
      res.headers.get("X-Tipo-Documento") || res.headers.get("x-tipo-documento") || null;

    await res.arrayBuffer().catch(() => undefined);

    return {
      ok: res.ok && !!expNro,
      expNro,
      caratula: caratula || null,
      tipoDocumento,
    };
  } catch (e) {
    console.warn("[detect-type-upload] Railway fetch failed:", endpoint, e);
    return { ok: false, expNro: null, caratula: null, tipoDocumento: null };
  }
}

const emptyRailway: RailwayTryResult = {
  ok: false,
  expNro: null,
  caratula: null,
  tipoDocumento: null,
};

/**
 * Railway solo para expediente/carátula. El tipo lo define GPT Vision (o fallback local).
 */
async function railwayMetadataForTipo(
  buffer: Buffer,
  tipo: DocTipo
): Promise<RailwayTryResult> {
  const railwayUrl = process.env.RAILWAY_OCR_URL?.trim();
  if (!railwayUrl) return emptyRailway;

  const base = railwayUrl.replace(/\/$/, "");
  const endpoint = tipo === "OFICIO" ? "/procesar-oficio" : "/procesar";
  const filename = tipo === "OFICIO" ? "oficio.pdf" : "cedula.pdf";
  return tryRailwayEndpoint(base, endpoint, buffer, filename);
}

/** Fallback sin GPT: ambos endpoints + resolver conservador. */
async function railwayClassifyPdfFallback(
  buffer: Buffer,
  textHint: DocTipo | null
): Promise<{
  tipo: DocTipo | null;
  autoDetected: boolean;
  expNro: string | null;
  caratula: string | null;
}> {
  try {
    const railwayUrl = process.env.RAILWAY_OCR_URL?.trim();
    if (!railwayUrl) {
      return { tipo: null, autoDetected: false, expNro: null, caratula: null };
    }

    const base = railwayUrl.replace(/\/$/, "");

    const [ced, ofi] = await Promise.all([
      tryRailwayEndpoint(base, "/procesar", buffer, "cedula.pdf"),
      tryRailwayEndpoint(base, "/procesar-oficio", buffer, "oficio.pdf"),
    ]);

    const resolved = resolveTipoFromRailwayAttempts(ced, ofi, textHint);
    if (resolved) {
      return resolved;
    }

    return { tipo: null, autoDetected: false, expNro: null, caratula: null };
  } catch (e) {
    console.warn("[detect-type-upload] railwayClassifyPdfFallback:", e);
    return { tipo: null, autoDetected: false, expNro: null, caratula: null };
  }
}

async function classifyPdfUpload(
  buf: Buffer,
  fileName: string
): Promise<{
  tipo: DocTipo | null;
  autoDetected: boolean;
  expNro: string | null;
  caratula: string | null;
}> {
  const [localTipo, scoringTipo] = await Promise.all([
    detectTipoLocalFromPdfBuffer(buf, fileName),
    clasificarTipoDesdePdfBuffer(buf, PDF_CLASSIFY_MAX_PAGES).catch(() => null),
  ]);
  const textHint = scoringTipo ?? localTipo;

  if (gptVisionHabilitado()) {
    const gpt = await clasificarTipoDocumentoConGptVision(buf, {
      maxPages: parseGptMaxPages(),
    });

    if (gpt.ok && (gpt.tipo === "CEDULA" || gpt.tipo === "OFICIO")) {
      const autoDetected = gptTipoEsDefinitivo(gpt.tipo, gpt.confianza);
      console.info("[detect-type-upload] GPT Vision", {
        file: fileName,
        tipo: gpt.tipo,
        confianza: gpt.confianza,
        autoDetected,
        paginas: gpt.paginas_enviadas,
        modelo: gpt.modelo,
      });

      const rail = await railwayMetadataForTipo(buf, gpt.tipo);
      return {
        tipo: gpt.tipo,
        autoDetected,
        expNro: rail.expNro ?? gpt.respuesta.expediente,
        caratula: rail.caratula ?? gpt.respuesta.caratula,
      };
    }

    if (gpt.ok && gpt.tipo === "INDETERMINADO") {
      console.info("[detect-type-upload] GPT Vision INDETERMINADO", {
        file: fileName,
        confianza: gpt.confianza,
      });
    } else if (!gpt.ok) {
      console.warn("[detect-type-upload] GPT Vision falló, fallback Railway/local", {
        file: fileName,
        error: gpt.error,
      });
    }
  }

  const rail = await railwayClassifyPdfFallback(buf, textHint);

  if (rail.tipo && rail.autoDetected) {
    return {
      tipo: rail.tipo,
      autoDetected: true,
      expNro: rail.expNro,
      caratula: rail.caratula,
    };
  }

  if (!rail.tipo && (rail.expNro || rail.caratula)) {
    return {
      tipo: textHint ?? localTipo,
      autoDetected: false,
      expNro: rail.expNro,
      caratula: rail.caratula,
    };
  }

  return {
    tipo: rail.tipo ?? textHint ?? localTipo,
    autoDetected: false,
    expNro: rail.expNro,
    caratula: rail.caratula,
  };
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({
        tipo: null,
        autoDetected: false,
        expNro: null,
        caratula: null,
      });
    }

    const name = (file.name || "").toLowerCase();
    const ext = name.split(".").pop() || "";

    if (ext === "pdf") {
      const buf = Buffer.from(await file.arrayBuffer());
      const result = await classifyPdfUpload(buf, file.name || "");
      return NextResponse.json(result);
    }

    const localTipo = await detectTipoLocalFromFile(file);
    return NextResponse.json({
      tipo: localTipo,
      autoDetected: false,
      expNro: null,
      caratula: null,
    });
  } catch {
    return NextResponse.json({
      tipo: null,
      autoDetected: false,
      expNro: null,
      caratula: null,
    });
  }
}
