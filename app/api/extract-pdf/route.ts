import { NextResponse } from "next/server";

export const runtime = "nodejs";

const PDF_EXTRACTOR_URL = process.env.PDF_EXTRACTOR_URL || "";

/**
 * Endpoint que reenvía el archivo PDF al microservicio extractor
 * No parsea el PDF localmente, solo actúa como proxy
 */
export async function POST(req: Request) {
  try {
    // Verificar que la URL del microservicio está configurada
    if (!PDF_EXTRACTOR_URL || PDF_EXTRACTOR_URL.trim() === "") {
      console.error("PDF_EXTRACTOR_URL no está configurada en las variables de entorno");
      return NextResponse.json(
        { 
          error: "El servicio de extracción de PDF no está configurado. Por favor, configura PDF_EXTRACTOR_URL en las variables de entorno. Por ahora, puedes completar los campos manualmente.",
          caratula: null,
          juzgado: null 
        },
        { status: 503 }
      );
    }

    // Obtener el FormData del request
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { 
          error: "Falta el archivo (campo: file)",
          caratula: null,
          juzgado: null 
        },
        { status: 400 }
      );
    }

    // Verificar que es PDF
    const name = (file.name || "").toLowerCase();
    if (!name.endsWith(".pdf")) {
      return NextResponse.json(
        { 
          error: "Solo se aceptan archivos PDF",
          caratula: null,
          juzgado: null 
        },
        { status: 400 }
      );
    }

    // Crear nuevo FormData para reenviar al microservicio
    const forwardFormData = new FormData();
    
    // Convertir el File a Blob y agregarlo al FormData
    const fileBlob = new Blob([await file.arrayBuffer()], { 
      type: file.type || "application/pdf" 
    });
    forwardFormData.append("file", fileBlob, file.name);

    // Reenviar al microservicio
    let response: Response;
    try {
      // Configurar timeout de 30 segundos para el fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      response = await fetch(PDF_EXTRACTOR_URL, {
        method: "POST",
        body: forwardFormData,
        signal: controller.signal,
        // No establecer Content-Type, fetch lo hace automáticamente con FormData
      });
      
      clearTimeout(timeoutId);
    } catch (fetchError: any) {
      console.error("Error conectando al microservicio PDF extractor:", fetchError.message);
      
      // Si es un error de timeout o conexión, retornar mensaje amigable
      if (fetchError.name === 'AbortError') {
        return NextResponse.json(
          { 
            error: "El servicio de extracción de PDF tardó demasiado en responder. Puedes completar los campos manualmente.",
            caratula: null,
            juzgado: null 
          },
          { status: 504 }
        );
      }
      
      return NextResponse.json(
        { 
          error: "No se pudo conectar al servicio de extracción de PDF. Verifica que el microservicio esté corriendo y que PDF_EXTRACTOR_URL esté correctamente configurada. Por ahora, puedes completar los campos manualmente.",
          caratula: null,
          juzgado: null 
        },
        { status: 502 }
      );
    }

    // Si el microservicio respondió con error, retornar null pero no fallar
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Error desconocido");
      console.error("Error del microservicio PDF extractor:", response.status, errorText);
      
      // Retornar null silenciosamente para que el usuario pueda completar manualmente
      return NextResponse.json({
        caratula: null,
        juzgado: null,
        error: `El servicio de extracción respondió con error (${response.status}). Puedes completar los campos manualmente.`,
      });
    }

    // Parsear respuesta del microservicio
    let data: any;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error("Error parseando respuesta del microservicio:", parseError);
      return NextResponse.json({
        caratula: null,
        juzgado: null,
        error: "Error procesando respuesta del servicio.",
      });
    }

    // Retornar carátula y juzgado (pueden ser null)
    return NextResponse.json({
      caratula: data.caratula || null,
      juzgado: data.juzgado || null,
      // Opcional: incluir raw_preview si está disponible (para debug)
      ...(data.raw_preview ? { raw_preview: data.raw_preview } : {}),
    });
  } catch (e: any) {
    console.error("Error en /api/extract-pdf:", e);
    // En caso de error inesperado, retornar null para no romper el flujo
    return NextResponse.json({
      caratula: null,
      juzgado: null,
      error: e?.message || "Error inesperado procesando PDF.",
    });
  }
}
