import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

/**
 * Extrae la carátula de documentos OFICIO y Cédulas
 * Soporta múltiples formatos:
 * 1. OFICIO: exptenº/expten° seguido de número/año y carátula hasta paréntesis
 * 2. Cédula: Expediente caratulado: "..."
 * 3. Cédula: expten° / Expte N° seguido de número y carátula
 */
function extractCaratula(raw: string): string | null {
  if (!raw) return null;

  // Normalizar el texto - manejar diferentes tipos de comillas y espacios
  let text = raw
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/\u201C/g, '"')  // Comilla curva izquierda “
    .replace(/\u201D/g, '"')  // Comilla curva derecha ”
    .replace(/\u201E/g, '"')  // Comilla baja „
    .replace(/\u201F/g, '"')  // Comilla alta ‟
    .replace(/\u2033/g, '"')  // Comilla doble ″
    .replace(/\r/g, "")
    .replace(/\n+/g, " ") // Normalizar saltos de línea a espacios
    .replace(/\s+/g, " ") // Normalizar espacios múltiples
    .trim();

  // Detectar si es un documento OFICIO
  // Buscar "OFICIO" en los primeros 200 caracteres (para capturar "OFICIO" o "OFICIO LEY")
  const isOficio = /\bOFICIO\b/i.test(text.substring(0, 200));

  // Función auxiliar para limpiar la carátula: quitar comillas y paréntesis
  function cleanCaratula(value: string): string {
    // Normalizar comillas primero
    value = value
      .replace(/\u201C/g, '"')  // Comilla curva izquierda “
      .replace(/\u201D/g, '"')  // Comilla curva derecha ”
      .replace(/\u201E/g, '"')  // Comilla baja „
      .replace(/\u201F/g, '"'); // Comilla alta ‟
    // Eliminar comillas al inicio y final
    value = value.replace(/^[""]+|[""]+$/g, "").trim();
    // Eliminar todo el texto entre paréntesis (incluyendo los paréntesis)
    value = value.replace(/\([^)]*\)/g, "").trim();
    // Limpiar espacios múltiples que puedan quedar
    value = value.replace(/\s+/g, " ").trim();
    return value;
  }

  // PATRÓN ESPECIAL PARA OFICIO
  if (isOficio) {
    // Para OFICIO: La carátula es el PRIMER texto entre comillas que tenga patrón C/ o S/
    // Ejemplo: "TAPIA, CLAUDIA VERONICA Y OTROS c/ FORNERO, MIGUEL ANTONIO Y OTROS s/DAÑOS Y PERJUICIOS(ACC.TRAN. C/LES. O MUERTE)"
    // Resultado: "TAPIA, CLAUDIA VERONICA Y OTROS C/ FORNERO, MIGUEL ANTONIO Y OTROS S/DAÑOS Y PERJUICIOS"
    
    // ESTRATEGIA 1: Buscar después de "Expte N°" o "exptenº" seguido de número/año
    // Este es el patrón más específico y confiable para OFICIO
    // Acepta tanto con comillas como sin comillas
    // Ejemplo: "Expte N° 105662/2025 "TAPIA, CLAUDIA VERONICA..." o "exptenº 68365/2022 PEREZ..."
    let re = /(?:Expte\s*N°|expten[°º])\s+\d+\/\d+\s*(?:"([^"]+?)"|([A-ZÁÉÍÓÚÑ][^(]+?)(?:\(|\s+que\s+tramita|$))/i;
    let m = re.exec(text);
    if (m?.[1] || m?.[2]) {
      let value = cleanCaratula(m[1] || m[2] || "");
      if ((/[cC]\s*\/\s+/.test(value) || /[sS]\s*\/\s+/.test(value))
          && value.length > 10 && value.length < 500) {
        return value.toUpperCase();
      }
    }
    
    // ESTRATEGIA 2: Buscar TODOS los textos entre comillas y encontrar el primero que tenga patrón C/ o S/
    const quotesPattern = /"([^"]+?)"/g;
    let match;
    const matches: string[] = [];
    
    // Recopilar todas las coincidencias con texto de al menos 15 caracteres (carátulas suelen ser largas)
    while ((match = quotesPattern.exec(text)) !== null) {
      if (match[1] && match[1].trim().length > 15) {
        matches.push(match[1]);
      }
    }
    
    // Procesar cada coincidencia hasta encontrar una que tenga patrón de carátula
    for (const quotedText of matches) {
      let value = cleanCaratula(quotedText);
      
      // Validar que tiene patrón de carátula (C/ o S/) - más flexible
      const hasPattern = /[cC]\s*\/\s+/.test(value) || /[sS]\s*\/\s+/.test(value);
      const validLength = value.length > 15 && value.length < 500;
      
      if (hasPattern && validLength) {
        return value.toUpperCase();
      }
    }
    return null;
  }

  // Patrón 1: Expediente caratulado: "..." (formato original para Cédulas)
  // Captura el contenido ENTRE las comillas, no las comillas
  // Nota: las comillas ya están normalizadas a " en el texto
  let re = /Expediente\s+caratulado\s*:\s*"([^"]+)"/i;
  let m = re.exec(text);
  if (m?.[1]) {
    const value = cleanCaratula(m[1]);
    if (value.length) return value.toUpperCase();
  }

  // Patrón 2: Expediente caratulado sin comillas
  re = /Expediente\s+caratulado\s*:\s*([^.\n]+?)(?:\.|$|\n)/i;
  m = re.exec(text);
  if (m?.[1]) {
    const value = cleanCaratula(m[1]);
    if (value.length) return value.toUpperCase();
  }

  // Patrón 3: expten° / Expte N° seguido de número/año y carátula (para Cédulas)
  // Ejemplo: "expten° 68365/2022 PEREZ, ANDRES AVELINO Y OTRO C/ MAZZIOTA..."
  // O: "Expte N° 105662/2025 "TAPIA, CLAUDIA VERONICA Y OTROS C/ FORNERO..."
  // IMPORTANTE: Captura el contenido DESPUÉS del número/año y comillas iniciales (si existen)
  // Nota: las comillas ya están normalizadas a " en el texto
  re = /(?:expten[°º]|Expte\s+N°)\s+\d+\/\d+\s+"?([A-ZÁÉÍÓÚÑ][^"]*?)"?\s*(?:\(|\s+que\s+tramita|\.\s*$)/i;
  m = re.exec(text);
  if (m?.[1]) {
    let value = cleanCaratula(m[1]);
    // Asegurar que tiene el patrón básico de carátula (C/ o S/)
    if ((value.includes(" C/ ") || value.includes(" c/ ") || value.includes(" S/ ") || value.includes(" s/ ")) 
        && value.length > 10 && value.length < 500) {
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
    if (!name.endsWith(".docx")) {
      return NextResponse.json(
        { error: "Formato inválido. Solo DOCX." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer: buf });

    const caratula = extractCaratula(result.value || "");
    // Asegurar uppercase si hay resultado
    const caratulaFinal = caratula ? caratula.toUpperCase() : null;
    
    return NextResponse.json({ caratula: caratulaFinal });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Error leyendo DOCX." },
      { status: 500 }
    );
  }
}
