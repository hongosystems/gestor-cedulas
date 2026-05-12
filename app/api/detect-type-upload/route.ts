import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { getUserFromRequest } from "@/lib/auth-api";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Páginas en las que se busca “CEDULA” / “OFICIO” en la heurística local (texto embebido). */
const PDF_CLASSIFY_MAX_PAGES = 4;

function normalizePdfTextChunk(s: string): string {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Por cada página (en orden), decide si hay señal de OFICIO o CÉDULA.
 * OFICIO tiene prioridad si en la misma página aparecen ambas coincidencias.
 */
function detectTipoFromPageTexts(pageTexts: string[]): "CEDULA" | "OFICIO" | null {
  for (const raw of pageTexts) {
    const n = normalizePdfTextChunk(raw);
    if (!n) continue;

    const hasOficio = /\bOFICIO\b/.test(n);
    const hasCedula =
      /\bCEDULA\b/.test(n) || /\bCEDULA\s+DE\s+NOTIFICACION\b/.test(n);

    if (hasOficio) return "OFICIO";
    if (hasCedula) return "CEDULA";
  }
  return null;
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

async function detectTipoLocalFromPdfBuffer(buf: Buffer, fileName: string): Promise<"CEDULA" | "OFICIO" | null> {
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
  /* PDFs generados por PJN suelen nombrarse acredita-*.pdf (diligenciamiento de oficio) */
  if (/^acredita-/.test(name)) return "OFICIO";
  return null;
}

/**
 * Heurística local (texto embebido PDF páginas 1–4 / DOCX / nombre de archivo).
 */
async function detectTipoLocalFromFile(file: File): Promise<"CEDULA" | "OFICIO" | null> {
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
        /\bCEDULA\b/i.test(first500) || /\bCEDULA\s+DE\s+NOTIFICACION\b/i.test(first500);
      const first200 = normalizedText.substring(0, 200);
      const startsWithOficio =
        /^\s*OFICIO\b/i.test(normalizedText) || /\bOFICIO\b/i.test(first200);
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

type RailwayTryResult = {
  ok: boolean;
  expNro: string | null;
  caratula: string | null;
  tipoDocumento: string | null;
};

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

/**
 * POST /procesar primero (tipo vía X-Tipo-Documento); si falla, POST /procesar-oficio como respaldo.
 * Éxito = respuesta OK y header X-Exp-Nro no vacío (misma convención que procesar-ocr).
 */
async function railwayClassifyPdf(buffer: Buffer): Promise<{
  tipo: "CEDULA" | "OFICIO" | null;
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

    const ced = await tryRailwayEndpoint(base, "/procesar", buffer, "cedula.pdf");
    if (ced.ok) {
      const detectedTipo = ced.tipoDocumento === "OFICIO" ? "OFICIO" : "CEDULA";
      return {
        tipo: detectedTipo,
        autoDetected: true,
        expNro: ced.expNro,
        caratula: ced.caratula,
      };
    }

    const ofi = await tryRailwayEndpoint(base, "/procesar-oficio", buffer, "oficio.pdf");
    if (ofi.ok) {
      return {
        tipo: "OFICIO",
        autoDetected: true,
        expNro: ofi.expNro,
        caratula: ofi.caratula,
      };
    }

    return { tipo: null, autoDetected: false, expNro: null, caratula: null };
  } catch (e) {
    console.warn("[detect-type-upload] railwayClassifyPdf:", e);
    return { tipo: null, autoDetected: false, expNro: null, caratula: null };
  }
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
      // Clasificación local y Railway en paralelo: si Railway tira error/red, el local sigue aplicando.
      const [localTipo, rail] = await Promise.all([
        detectTipoLocalFromPdfBuffer(buf, file.name || ""),
        railwayClassifyPdf(buf),
      ]);
      if (rail.tipo && rail.autoDetected) {
        return NextResponse.json({
          tipo: rail.tipo,
          autoDetected: true,
          expNro: rail.expNro,
          caratula: rail.caratula,
        });
      }
      return NextResponse.json({
        tipo: localTipo,
        autoDetected: false,
        expNro: null,
        caratula: null,
      });
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
