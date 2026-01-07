import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

/**
 * Extrae el texto entre:
 *   TRIBUNAL <...> -
 * Soporta guiones: -, – y —
 * Soporta saltos de línea entre medio.
 */
function extractJuzgado(raw: string): string | null {
  if (!raw) return null;

  const text = raw
    .replace(/\u00a0/g, " ") // nbsp
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n");

  // Caso principal: TRIBUNAL ... -
  const re = /TRIBUNAL\s+([\s\S]*?)\s*[-–—]\s*/i;
  const m = re.exec(text);
  if (m?.[1]) {
    const value = m[1].replace(/\s+/g, " ").trim();
    return value.length ? value : null;
  }

  // Fallback: TRIBUNAL <línea> (si no aparece guion)
  const re2 = /TRIBUNAL\s+([^\n\r]+)/i;
  const m2 = re2.exec(text);
  if (m2?.[1]) {
    const value = m2[1].replace(/\s+/g, " ").trim();
    return value.length ? value : null;
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
      return NextResponse.json(
        { error: "Formato inválido. Solo DOCX." },
        { status: 400 }
      );
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
