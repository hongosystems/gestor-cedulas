import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

// Dynamic import for pdf-parse
async function loadPdfParse() {
  const pdfParseModule = await import("pdf-parse");
  return (pdfParseModule as any).default || pdfParseModule;
}

/**
 * Extrae el expediente/año del documento
 * Busca patrones como:
 * - "Expte N° 105662/2025"
 * - "expten° 68365/2022"
 * - "exptenº 68365/2022"
 * Retorna { numero: "105662", anio: 2025 } o null
 */
function extractExpediente(raw: string): { numero: string; anio: number } | null {
  if (!raw) return null;

  // Normalizar el texto
  let text = raw
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Patrón 1: Expte N° número/año
  // Ejemplo: "Expte N° 105662/2025"
  let re = /(?:Expte\s*N°|expten[°º])\s+(\d+)\/(\d{4})/i;
  let m = re.exec(text);
  if (m?.[1] && m?.[2]) {
    const numero = m[1].trim();
    const anio = parseInt(m[2], 10);
    if (!isNaN(anio) && anio >= 1900 && anio <= 2100) {
      return { numero, anio };
    }
  }

  // Patrón 2: Buscar cualquier patrón número/año que pueda ser expediente
  // Más flexible: busca "número/año" después de palabras clave
  re = /(?:expediente|expte|expten[°º]|exp\.?)\s*(?:n°|n\.?|°)?\s*(\d+)\/(\d{4})/i;
  m = re.exec(text);
  if (m?.[1] && m?.[2]) {
    const numero = m[1].trim();
    const anio = parseInt(m[2], 10);
    if (!isNaN(anio) && anio >= 1900 && anio <= 2100) {
      return { numero, anio };
    }
  }

  // Patrón 3: Solo número/año (más genérico, puede dar falsos positivos)
  // Buscar en las primeras 500 caracteres para evitar coincidencias aleatorias
  const first500 = text.substring(0, 500);
  re = /\b(\d{4,6})\/(\d{4})\b/;
  m = re.exec(first500);
  if (m?.[1] && m?.[2]) {
    const numero = m[1].trim();
    const anio = parseInt(m[2], 10);
    // Validar que el año sea razonable
    if (!isNaN(anio) && anio >= 1900 && anio <= 2100) {
      return { numero, anio };
    }
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
    const ext = name.split(".").pop()?.toLowerCase() || "";
    
    if (ext !== "docx" && ext !== "pdf") {
      return NextResponse.json(
        { error: "Formato inválido. Solo DOCX y PDF." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    let text = "";

    // Extraer texto según el tipo de archivo
    if (ext === "docx") {
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value || "";
    } else if (ext === "pdf") {
      try {
        const pdfParser = await loadPdfParse();
        const pdfData = await pdfParser(buf);
        text = pdfData.text || "";
      } catch (e: any) {
        return NextResponse.json(
          { error: "Error leyendo PDF: " + (e?.message || "Error desconocido") },
          { status: 500 }
        );
      }
    }

    const expediente = extractExpediente(text);
    
    return NextResponse.json({ 
      expediente: expediente ? `${expediente.numero}/${expediente.anio}` : null,
      numero: expediente?.numero || null,
      anio: expediente?.anio || null
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Error procesando archivo." },
      { status: 500 }
    );
  }
}
