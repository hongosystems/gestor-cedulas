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
    const supabaseAdmin = getSupabaseAdmin();

    // Verificar si el usuario es abogado
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("is_abogado, is_superadmin")
      .eq("user_id", userId)
      .maybeSingle();
    
    const isAbogado = roleData?.is_abogado === true;
    const isSuperadmin = roleData?.is_superadmin === true;

    // Verificar adicionalmente en la base de datos que existe una cédula con este pdf_path
    const { data: cedula, error: dbError } = await supabaseAdmin
      .from("cedulas")
      .select("id, owner_user_id, juzgado")
      .eq("pdf_path", path)
      .maybeSingle();

    if (dbError || !cedula) {
      return new NextResponse("No se encontró el archivo en la base de datos", {
        status: 404,
      });
    }

    // Si es el dueño, permitir acceso
    if (cedula.owner_user_id === userId) {
      // Acceso permitido
    } 
    // Si es abogado o superadmin, verificar acceso por juzgado
    else if (isAbogado || isSuperadmin) {
      // Obtener juzgados asignados al usuario
      const { data: juzgadosData } = await supabaseAdmin
        .from("user_juzgados")
        .select("juzgado")
        .eq("user_id", userId);
      
      const juzgadosAsignados = (juzgadosData || []).map(j => 
        j.juzgado?.trim().replace(/\s+/g, " ").toUpperCase()
      );
      
      // Normalizar juzgado de la cédula
      const juzgadoCedula = cedula.juzgado 
        ? cedula.juzgado.trim().replace(/\s+/g, " ").toUpperCase()
        : null;
      
      // Verificar si el juzgado de la cédula está en los juzgados asignados
      let tieneAcceso = false;
      
      if (juzgadoCedula && juzgadosAsignados.length > 0) {
        // Comparación exacta
        tieneAcceso = juzgadosAsignados.some(jAsignado => {
          if (jAsignado === juzgadoCedula) return true;
          
          // Comparación por número de juzgado (más flexible)
          const numAsignado = jAsignado.match(/N[°º]\s*(\d+)/i)?.[1];
          const numCedula = juzgadoCedula.match(/N[°º]\s*(\d+)/i)?.[1];
          
          if (numAsignado && numCedula && numAsignado === numCedula) {
            // Si ambos tienen el mismo número y contienen "Juzgado", considerarlos iguales
            return jAsignado.includes("JUZGADO") && juzgadoCedula.includes("JUZGADO");
          }
          
          return false;
        });
      }
      
      // Si es superadmin, permitir acceso a todo
      if (isSuperadmin) {
        tieneAcceso = true;
      }
      
      if (!tieneAcceso) {
        return new NextResponse("No tienes permisos para acceder a este archivo. El juzgado no está asignado a tu cuenta.", {
          status: 403,
        });
      }
    } 
    // Si no es el dueño ni tiene rol especial, denegar acceso
    else {
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