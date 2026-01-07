import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

/**
 * Carga pdfjs-dist (v3) vía require para evitar problemas de ESM/exports en Next.
 */
function getPdfJs(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  return pdfjs;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = getPdfJs();

  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data: uint8, disableWorker: true });
  const pdf = await loadingTask.promise;

  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const strings = (content.items || [])
      .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
      .filter(Boolean);

    out += strings.join(" ") + "\n";
  }
  return out;
}

/**
 * Extrae Juzgado entre TRIBUNAL y '-'
 * Ej: "TRIBUNAL JUZGADO ... Nº 17 - Sito en ..."
 * Fallback: si no hay '-' claro, corta por "Sito en".
 */
function extractJuzgado(raw: string): string | null {
  if (!raw) return null;

  const norm = raw
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Caso principal: TRIBUNAL ... -
  let m = /TRIBUNAL\s+(.+?)\s*-\s*/i.exec(norm);
  if (m?.[1]) {
    const v = m[1].trim();
    return v.length ? v : null;
  }

  // Fallback: TRIBUNAL ... Sito en
  m = /TRIBUNAL\s+(.+?)\s+Sito\s+en\s+/i.exec(norm);
  if (m?.[1]) {
    const v = m[1].trim();
    return v.length ? v : null;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Falta el archivo (campo: file)." },
        { status: 400 }
      );
    }

    const name = (file.name || "").toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());

    let rawText = "";

    if (name.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer: buf });
      rawText = result.value || "";
    } else if (name.endsWith(".pdf")) {
      rawText = await extractPdfText(buf);
    } else {
      return NextResponse.json(
        { error: "Formato inválido. Solo PDF o DOCX." },
        { status: 400 }
      );
    }

    const juzgado = extractJuzgado(rawText);
    return NextResponse.json({ juzgado });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Error leyendo archivo." },
      { status: 500 }
    );
  }
}
