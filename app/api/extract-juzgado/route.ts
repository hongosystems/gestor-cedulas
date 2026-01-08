import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

// Dynamic import for pdf-parse
async function loadPdfParse() {
  const pdfParseModule = await import("pdf-parse");
  // pdf-parse puede exportar como default o como named export
  return (pdfParseModule as any).default || pdfParseModule;
}

/**
 * Extrae el Juzgado de documentos OFICIO
 * Soporta múltiples formatos:
 * 1. TRIBUNAL ... - (formato original)
 * 2. que tramita ante el Juzgado... (formato OFICIO)
 */
function extractJuzgado(raw: string): string | null {
  if (!raw) return null;

  const norm = raw
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ") // Normalizar saltos de línea
    .replace(/\s+/g, " ") // Normalizar espacios múltiples
    .trim();

  // Patrón 1: "que tramita ante el Juzgado..." (formato OFICIO más común)
  // IMPORTANTE: Capturar solo hasta el número del juzgado (N° seguido de número), CORTAR INMEDIATAMENTE después
  // Ejemplo: "que tramita ante el Juzgado Nacional en lo Civil N° 89..." -> "JUZGADO NACIONAL EN LO CIVIL N° 89"
  // El patrón captura hasta N°\d+ y luego cortamos todo lo que sigue
  let m = /que\s+tramita\s+ante\s+(?:el\s+)?(Juzgado[^,]*?\bN°\s*\d+)/i.exec(norm);
  if (m?.[1]) {
    let value = m[1].trim();
    // CORTAR todo después del número - asegurar que solo capturamos hasta N° número
    const numeroMatch = value.match(/^(.*?\bN°\s*\d+)/i);
    if (numeroMatch) {
      value = numeroMatch[1].trim();
    }
    // Limpiar y normalizar - quitar comas finales y espacios extra
    value = value.replace(/,\s*$/, "").replace(/\s+/g, " ").trim();
    // Verificar que tiene número de juzgado (N° seguido de número)
    if (/\bN°\s*\d+/i.test(value) && value.length > 10 && value.length < 200) {
      return value.toUpperCase();
    }
  }

  // Patrón 2: Versión sin "el" - "que tramita ante Juzgado..."
  m = /que\s+tramita\s+ante\s+(Juzgado[^,]*?\bN°\s*\d+)/i.exec(norm);
  if (m?.[1]) {
    let value = m[1].trim();
    // CORTAR todo después del número
    const numeroMatch = value.match(/^(.*?\bN°\s*\d+)/i);
    if (numeroMatch) {
      value = numeroMatch[1].trim();
    }
    value = value.replace(/,\s*$/, "").replace(/\s+/g, " ").trim();
    if (/\bN°\s*\d+/i.test(value) && value.length > 10 && value.length < 200) {
      return value.toUpperCase();
    }
  }

  // Patrón 3: TRIBUNAL ... - (formato original para compatibilidad)
  // Si tiene número de juzgado, cortar ahí
  m = /TRIBUNAL\s+(.+?)(?:\s*-\s*|\s+Sito\s+en\s+)/i.exec(norm);
  if (m?.[1]) {
    let v = m[1].trim();
    // Si tiene número de juzgado, cortar después del número
    const numeroMatch = v.match(/^(.*?\bN°\s*\d+)/i);
    if (numeroMatch) {
      v = numeroMatch[1].trim();
    }
    if (v.length && v.length < 200) return v.toUpperCase();
  }

  // Patrón 4: Buscar directamente "Juzgado Nacional..." (fallback más flexible)
  // IMPORTANTE: Solo hasta el número del juzgado
  m = /(Juzgado\s+Nacional[^.]*?\bN°\s*\d+)/i.exec(norm);
  if (m?.[1]) {
    let value = m[1].trim();
    value = value.replace(/,\s*$/, "").replace(/\s+/g, " ").trim();
    // Verificar que tenga número de juzgado (N° seguido de número)
    if (/\bN°\s*\d+/i.test(value) && value.length > 10 && value.length < 200) {
      return value.toUpperCase();
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
      return NextResponse.json({ juzgado: null });
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
        // Si falla el parseo del PDF, retornar null silenciosamente
        return NextResponse.json({ juzgado: null });
      }
    }
    
    const juzgado = extractJuzgado(text);
    // Asegurar uppercase si hay resultado
    const juzgadoFinal = juzgado ? juzgado.toUpperCase() : null;
    
    return NextResponse.json({ juzgado: juzgadoFinal });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Error leyendo DOCX." },
      { status: 500 }
    );
  }
}
