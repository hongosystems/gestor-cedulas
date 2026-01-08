import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Variables de entorno de Supabase no configuradas");
  }
  
  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const path = searchParams.get("path");
    const token = searchParams.get("token");

    if (!path) {
      return new NextResponse("Falta el parámetro 'path'", { status: 400 });
    }

    if (!token) {
      return new NextResponse("Falta el token de autenticación", { status: 401 });
    }

    // Decodificar el JWT para obtener el user_id (sin verificar firma, solo decodificar)
    let userId: string | null = null;
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        userId = payload.sub || payload.user_id;
      }
    } catch (decodeError) {
      return new NextResponse("Token inválido", { status: 401 });
    }

    if (!userId) {
      return new NextResponse("No se pudo obtener el usuario del token", { status: 401 });
    }

    // Verificar que el archivo pertenece al usuario consultando la base de datos
    // El path tiene formato: {uid}/{cedulaId}.{ext}
    const pathParts = path.split("/");
    if (pathParts.length < 2) {
      return new NextResponse("Formato de path inválido", { status: 400 });
    }

    const pathUserId = pathParts[0];

    // Verificar que el path coincide con el user_id del token
    if (userId !== pathUserId) {
      return new NextResponse("No tienes permisos para acceder a este archivo", {
        status: 403,
      });
    }

    // Verificar adicionalmente en la base de datos que existe una cédula con este pdf_path
    // que pertenece al usuario (doble verificación de seguridad)
    const supabaseAdmin = getSupabaseAdmin();
    const { data: cedula, error: dbError } = await supabaseAdmin
      .from("cedulas")
      .select("id, owner_user_id")
      .eq("pdf_path", path)
      .eq("owner_user_id", userId)
      .single();

    if (dbError || !cedula) {
      return new NextResponse("No tienes permisos para acceder a este archivo", {
        status: 403,
      });
    }

    // Descargar el archivo desde Supabase
    const { data, error } = await supabaseAdmin.storage
      .from("cedulas")
      .download(path);

    if (error || !data) {
      return new NextResponse(error?.message || "No se pudo obtener el archivo", {
        status: 404,
      });
    }

    // Convertir el Blob a ArrayBuffer
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determinar el Content-Type basado en la extensión
    const ext = path.split(".").pop()?.toLowerCase();
    let contentType = "application/octet-stream";
    
    if (ext === "pdf") {
      contentType = "application/pdf";
    } else if (ext === "docx") {
      contentType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (ext === "doc") {
      contentType = "application/msword";
    }

    // Retornar el archivo con headers que fuerzan la visualización en el navegador
    // Para PDFs y documentos, usar 'inline' para que se abra en el navegador
    const filename = path.split("/").pop() || "archivo";
    
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e: any) {
    return new NextResponse(e?.message || "Error al abrir el archivo", {
      status: 500,
    });
  }
}