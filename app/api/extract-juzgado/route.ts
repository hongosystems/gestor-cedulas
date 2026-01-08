import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

/**
 * Extrae Juzgado entre TRIBUNAL y '-'
 * Solo para DOCX (estable). PDF: no se procesa.
 */
function extractJuzgado(raw: string): string | null {
  if (!raw) return null;

  const norm = raw
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
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

    if (!name.endsWith(".docx")) {
      // Estable: no parseamos PDF
      return NextResponse.json({ juzgado: null });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer: buf });
    const juzgado = extractJuzgado(result.value || "");

    return NextResponse.json({ juzgado });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Error leyendo DOCX." },
      { status: 500 }
    );
  }
}
