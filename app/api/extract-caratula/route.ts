import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

async function extractPdfText(buffer: Buffer): Promise<string> {
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
 * Extrae Carátula entre comillas luego de:
 * Expediente caratulado: “...”
 * Soporta “ ” y " "
 */
function extractCaratula(raw: string): string | null {
  if (!raw) return null;

  const norm = raw
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const re = /Expediente\s+caratulado\s*:\s*[“"]([\s\S]*?)[”"]/i;
  const m = re.exec(norm);
  if (m?.[1]) {
    const v = m[1].trim();
    return v.length ? v : null;
  }

  const re2 = /Expediente\s+caratulado\s*:\s*([^.\n]+?)(?:\s{2,}|$)/i;
  const m2 = re2.exec(norm);
  if (m2?.[1]) {
    const v = m2[1].trim().replace(/^["“]|["”]$/g, "");
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

    const caratula = extractCaratula(rawText);
    return NextResponse.json({ caratula });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Error leyendo archivo." },
      { status: 500 }
    );
  }
}
