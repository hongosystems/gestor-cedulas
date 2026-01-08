import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

/**
 * Detecta si un documento es CÉDULA u OFICIO desde un archivo subido
 * Versión optimizada para usar durante el upload (no requiere descargar desde storage)
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ tipo: null });
    }

    const name = (file.name || "").toLowerCase();
    const ext = name.split(".").pop() || "";

    // Para PDFs o archivos sin extensión, intentar detectar por nombre
    if (ext !== "docx" && ext !== "doc") {
      const nameUpper = name.toUpperCase();
      if (/OFICIO/i.test(nameUpper)) {
        return NextResponse.json({ tipo: "OFICIO" });
      } else if (/CEDULA/i.test(nameUpper)) {
        return NextResponse.json({ tipo: "CEDULA" });
      }
      return NextResponse.json({ tipo: null });
    }

    // Para DOCX, extraer texto y detectar
    if (ext === "docx") {
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        const result = await mammoth.extractRawText({ buffer: buf });
        const text = result.value || "";

        if (!text || text.trim().length === 0) {
          return NextResponse.json({ tipo: null });
        }

        // Normalizar el texto
        const normalizedText = text
          .replace(/\u00A0/g, " ")
          .replace(/\r/g, "")
          .replace(/\n+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toUpperCase();

        // Buscar "CEDULA" o "CEDULA DE NOTIFICACION" en las primeras 500 caracteres
        const first500 = normalizedText.substring(0, 500);
        const hasCedula = /\bCEDULA\b/i.test(first500) || /\bCEDULA\s+DE\s+NOTIFICACION\b/i.test(first500);

        // Buscar "OFICIO" como primera palabra o en las primeras 200 caracteres
        const first200 = normalizedText.substring(0, 200);
        const startsWithOficio = /^\s*OFICIO\b/i.test(normalizedText) || /\bOFICIO\b/i.test(first200);

        // Priorizar OFICIO si está al inicio, sino CÉDULA si tiene "CEDULA"
        let tipo: "CEDULA" | "OFICIO" | null = null;
        if (startsWithOficio) {
          tipo = "OFICIO";
        } else if (hasCedula) {
          tipo = "CEDULA";
        }

        return NextResponse.json({ tipo });
      } catch (e: any) {
        // Si falla, intentar por nombre del archivo
        const nameUpper = name.toUpperCase();
        if (/OFICIO/i.test(nameUpper)) {
          return NextResponse.json({ tipo: "OFICIO" });
        } else if (/CEDULA/i.test(nameUpper)) {
          return NextResponse.json({ tipo: "CEDULA" });
        }
        return NextResponse.json({ tipo: null });
      }
    }

    return NextResponse.json({ tipo: null });
  } catch (e: any) {
    return NextResponse.json({ tipo: null });
  }
}
