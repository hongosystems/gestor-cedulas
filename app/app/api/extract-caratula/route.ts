// app/api/extract-caratula/route.ts
import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

function extractCaratulaFromText(txt: string) {
  // Soporta comillas “ ” y " "
  const re = /Expediente\s+caratulado:\s*[“"]([\s\S]*?)[”"]/i;
  const m = txt.match(re);
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").trim();
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta el archivo (file)." }, { status: 400 });
    }

    const name = (file.name || "").toLowerCase();
    const isDocx =
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.endsWith(".docx");

    if (!isDocx) {
      return NextResponse.json(
        { error: "Este endpoint solo acepta DOCX." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer: buf });

    const caratula = extractCaratulaFromText(value || "");
    return NextResponse.json({ caratula });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Error leyendo DOCX." },
      { status: 500 }
    );
  }
}
