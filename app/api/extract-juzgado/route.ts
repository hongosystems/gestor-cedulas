import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

async function extractPdfText(buffer: Buffer): Promise<string> {
  // ✅ Ruta correcta para pdfjs-dist v5 en Next/Vercel
  const pdfjsMod: any = await import("pdfjs-dist/legacy/build/pdf");
  const pdfjs: any = pdfjsMod?.default ?? pdfjsMod;

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
 * Extrae Juzgado entre TRIBUNAL y -
 * Ej: TRIBUNAL  JUZGADO ... Nº 17 - Sito en ...
 */
function extractJuzgado(raw: string): string | null {
  if (!raw) return null;

  const norm = raw
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const re = /TRIBUNAL\s+(.+?)\s*-\s*/i;
  const m = re.exec(norm);
  if (!m?.[1]) return null;

  const value = m[1].trim();
  return value.length ? value : null;
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
