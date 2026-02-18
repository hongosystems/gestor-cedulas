import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  try {
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    if (!url || !anon) {
      return null;
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const { data: { user }, error } = await supabaseClient.auth.getUser(token);
    
    if (error || !user) {
      return null;
    }

    return user;
  } catch (e: any) {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const ordenId = searchParams.get("orden_id");
    const archivoId = searchParams.get("archivo_id"); // Opcional: ID del archivo específico

    if (!ordenId) {
      return new NextResponse("Falta orden_id", { status: 400 });
    }

    const svc = supabaseService();

    // Obtener la orden
    const { data: orden, error: ordenError } = await svc
      .from("ordenes_medicas")
      .select("id, case_ref, emitida_por_user_id, expediente_id")
      .eq("id", ordenId)
      .single();

    if (ordenError || !orden) {
      return new NextResponse("Orden no encontrada", { status: 404 });
    }

    // Verificar permisos
    let tieneAcceso = false;

    // Si es el emisor, tiene acceso
    if (orden.emitida_por_user_id === user.id) {
      tieneAcceso = true;
    }
    // Si tiene acceso al expediente relacionado
    else if (orden.expediente_id) {
      const { data: expediente } = await svc
        .from("expedientes")
        .select("owner_user_id")
        .eq("id", orden.expediente_id)
        .single();

      if (expediente && expediente.owner_user_id === user.id) {
        tieneAcceso = true;
      }
    }

    // Verificar si es admin o superadmin
    if (!tieneAcceso) {
      const { data: roleData } = await svc
        .from("user_roles")
        .select("is_superadmin, is_admin_expedientes")
        .eq("user_id", user.id)
        .maybeSingle();

      const isSuperadmin = roleData?.is_superadmin === true;
      const isAdminExp = roleData?.is_admin_expedientes === true;

      if (isSuperadmin || isAdminExp) {
        tieneAcceso = true;
      }
    }

    if (!tieneAcceso) {
      return new NextResponse("No autorizado", { status: 403 });
    }

    // Si se especifica archivo_id, descargar solo ese archivo
    if (archivoId) {
      const { data: archivoData, error: archivoError } = await svc
        .from("ordenes_medicas_archivos")
        .select("id, storage_path, filename, mime")
        .eq("id", archivoId)
        .eq("orden_id", ordenId)
        .single();
      
      if (archivoError || !archivoData) {
        return new NextResponse("Archivo no encontrado", { status: 404 });
      }

      // Descargar archivo desde Storage
      const { data: fileData, error: downloadError } = await svc.storage
        .from("ordenes-medicas")
        .download(archivoData.storage_path);

      if (downloadError || !fileData) {
        return new NextResponse("Error al descargar el archivo", { status: 500 });
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Retornar archivo individual
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": archivoData.mime || "application/pdf",
          "Content-Disposition": `attachment; filename="${archivoData.filename || "orden-medica.pdf"}"`,
          "Content-Length": buffer.length.toString(),
        },
      });
    }

    // Si no se especifica archivo_id, descargar todos los archivos como ZIP
    // Obtener todos los archivos de la orden
    const { data: archivosData, error: archivosError } = await svc
      .from("ordenes_medicas_archivos")
      .select("id, storage_path, filename, mime, orden_archivo")
      .eq("orden_id", ordenId)
      .order("orden_archivo", { ascending: true });

    let archivos: any[] = [];

    if (archivosError || !archivosData || archivosData.length === 0) {
      // Si no hay archivos en la nueva tabla, intentar usar el storage_path de la orden (compatibilidad hacia atrás)
      const { data: ordenCompleta } = await svc
        .from("ordenes_medicas")
        .select("storage_path, filename, mime")
        .eq("id", ordenId)
        .single();
      
      if (ordenCompleta && ordenCompleta.storage_path) {
        // Descargar archivo único (compatibilidad hacia atrás)
        const { data: fileData, error: downloadError } = await svc.storage
          .from("ordenes-medicas")
          .download(ordenCompleta.storage_path);

        if (downloadError || !fileData) {
          return new NextResponse("Error al descargar el archivo", { status: 500 });
        }

        const arrayBuffer = await fileData.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        return new NextResponse(buffer, {
          headers: {
            "Content-Type": ordenCompleta.mime || "application/pdf",
            "Content-Disposition": `attachment; filename="${ordenCompleta.filename || "orden-medica.pdf"}"`,
            "Content-Length": buffer.length.toString(),
          },
        });
      } else {
        return new NextResponse("No se encontraron archivos para esta orden", { status: 404 });
      }
    }

    archivos = archivosData;

    // Si solo hay un archivo, descargarlo directamente sin ZIP
    if (archivos.length === 1) {
      const archivo = archivos[0];
      const { data: fileData, error: downloadError } = await svc.storage
        .from("ordenes-medicas")
        .download(archivo.storage_path);

      if (downloadError || !fileData) {
        return new NextResponse("Error al descargar el archivo", { status: 500 });
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return new NextResponse(buffer, {
        headers: {
          "Content-Type": archivo.mime || "application/pdf",
          "Content-Disposition": `attachment; filename="${archivo.filename || "orden-medica.pdf"}"`,
          "Content-Length": buffer.length.toString(),
        },
      });
    }

    // Si hay múltiples archivos, crear ZIP usando JSZip
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    // Descargar todos los archivos y agregarlos al ZIP
    for (const archivo of archivos) {
      try {
        const { data: fileData, error: downloadError } = await svc.storage
          .from("ordenes-medicas")
          .download(archivo.storage_path);

        if (downloadError || !fileData) {
          console.error(`Error descargando archivo ${archivo.filename}:`, downloadError);
          continue; // Continuar con el siguiente archivo
        }

        const arrayBuffer = await fileData.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Agregar archivo al ZIP con nombre único
        const nombreArchivo = archivo.filename || `archivo-${archivo.orden_archivo}.pdf`;
        zip.file(nombreArchivo, buffer);
      } catch (err) {
        console.error(`Error procesando archivo ${archivo.filename}:`, err);
        continue;
      }
    }

    // Generar el ZIP como buffer
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const caseRef = orden.case_ref || ordenId.substring(0, 8);
    const zipFilename = `orden-medica-${caseRef}.zip`;

    // Retornar ZIP
    return new NextResponse(zipBuffer as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipFilename}"`,
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (e: any) {
    console.error("Error en download:", e);
    return new NextResponse("Error desconocido", { status: 500 });
  }
}
