import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Detecta si un documento es CÉDULA u OFICIO
 * - CÉDULA: Tiene "CEDULA" o "CEDULA DE NOTIFICACION" en el texto (especialmente arriba/centro)
 * - OFICIO: La primera palabra del documento es "OFICIO"
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json({ error: "Falta el parámetro 'path'." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Extraer userId del path
    const pathParts = path.split("/");
    if (pathParts.length < 2) {
      return NextResponse.json({ error: "Path inválido." }, { status: 400 });
    }
    const pathUserId = pathParts[0];

    // Verificar autenticación (opcional pero recomendado)
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      try {
        const token = authHeader.replace("Bearer ", "");
        const { createClient: createClientPublic } = require("@supabase/supabase-js");
        const supabaseClient = createClientPublic(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const { data: { user } } = await supabaseClient.auth.getUser(token);
        if (!user || user.id !== pathUserId) {
          return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
      } catch (e) {
        // Si falla la autenticación, continuar con service role
      }
    }

    // Descargar el archivo desde Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("cedulas")
      .download(path);

    if (downloadError || !fileData) {
      // Si no se puede descargar el archivo, retornar null en lugar de error
      // para que el frontend no falle
      return NextResponse.json({ tipo: null });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const fileName = path.split("/").pop() || "";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";

    let text = "";

    // Extraer texto según el tipo de archivo
    if (ext === "docx") {
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value || "";
      } catch (e: any) {
        return NextResponse.json({ error: "Error leyendo DOCX." }, { status: 500 });
      }
    } else if (ext === "pdf") {
      // Para PDFs, detectar por el nombre del archivo como fallback
      // Si el nombre contiene "oficio" o "cedula", usar eso
      const fileNameUpper = fileName.toUpperCase();
      if (/OFICIO/i.test(fileNameUpper)) {
        return NextResponse.json({ tipo: "OFICIO" });
      } else if (/CEDULA/i.test(fileNameUpper)) {
        return NextResponse.json({ tipo: "CEDULA" });
      }
      // Si no se puede determinar por el nombre, retornar null (no error)
      return NextResponse.json({ tipo: null });
    } else {
      return NextResponse.json({ tipo: null });
    }

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
    return NextResponse.json({ error: e?.message || "Error detectando tipo." }, { status: 500 });
  }
}
