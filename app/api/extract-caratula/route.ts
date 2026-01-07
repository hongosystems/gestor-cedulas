import { NextResponse } from "next/server";

export const runtime = "nodejs";

// mammoth es CommonJS: en Next/TS la forma más robusta es require()
/* eslint-disable @typescript-eslint/no-var-requires */
const mammoth = require("mammoth");
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Extrae el texto entre comillas luego de:
 * Expediente caratulado: “...”
 * Soporta comillas curvas “ ” y comillas rectas " "
 */
function extractCaratula(raw: string): string | null {
  if (!raw) return null;

  const text = raw
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n");

  // 1) Caso principal: comillas curvas o rectas
  const re = /Expediente\s+caratulado\s*:\s*[“"]([\s\S]*?)[”"]/i;
  const m = re.exec(text);
  if (m?.[1]) {
    const value = m[1].trim();
    return value.length ? value : null;
  }

  // 2) Fallback: sin comillas, tomar línea
  const re2 = /Expediente\s+caratulado\s*:\s*([^\n]+)\n?/i;
  const m2 = re2.exec(text);
  if (m2?.[1]) {
    const value = m2[1].trim().replace(/^["“]|["”]$/g, "");
    return value.length ? value : null;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const fileAny = form.get("file") as any;

    // Validación robusta (no dependemos de instanceof File)
    if (!fileAny || typeof fileAny.arrayBuffer !== "function") {
      return NextResponse.json(
        { error: "Falta el archivo (campo: file)." },
        { status: 400 }
      );
    }

    const name = String(fileAny.name || "").toLowerCase();
    if (!name.endsWith(".docx")) {
      return NextResponse.json(
        { error: "Formato inválido. Solo DOCX." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await fileAny.arrayBuffer());

    // mammoth devuelve { value: string }
    const result = await mammoth.extractRawText({ buffer: buf });

    const caratula = extractCaratula(result?.value || "");
    return NextResponse.json({ caratula });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Error leyendo DOCX." },
      { status: 500 }
    );
  }
}
