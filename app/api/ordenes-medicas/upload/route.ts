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
      console.error("Missing Supabase env vars");
      return null;
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const { data: { user }, error } = await supabaseClient.auth.getUser(token);
    
    if (error || !user) {
      console.error("Auth error:", error?.message);
      return null;
    }

    return user;
  } catch (e: any) {
    console.error("Error getting user:", e?.message);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const caseRef = formData.get("case_ref") as string | null;
    const expedienteId = formData.get("expediente_id") as string | null;

    if (!caseRef || !caseRef.trim()) {
      return NextResponse.json({ error: "Falta case_ref" }, { status: 400 });
    }

    // Obtener todos los archivos (hasta 5)
    const files: File[] = [];
    for (let i = 0; i < 5; i++) {
      const file = formData.get(`file_${i}`) as File | null;
      if (file) {
        files.push(file);
      }
    }
    // También verificar el campo "file" para compatibilidad
    const singleFile = formData.get("file") as File | null;
    if (singleFile && files.length === 0) {
      files.push(singleFile);
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "Falta al menos un archivo" }, { status: 400 });
    }

    if (files.length > 5) {
      return NextResponse.json({ error: "Máximo 5 archivos por orden" }, { status: 400 });
    }

    const svc = supabaseService();

    // Validar expediente_id si se proporciona
    if (expedienteId) {
      const { data: expediente, error: expError } = await svc
        .from("expedientes")
        .select("id, owner_user_id")
        .eq("id", expedienteId)
        .single();

      if (expError || !expediente) {
        return NextResponse.json(
          { error: "Expediente no encontrado" },
          { status: 404 }
        );
      }

      // Verificar que el usuario tenga acceso al expediente
      if (expediente.owner_user_id !== user.id) {
        // Verificar si es admin o superadmin
        const { data: roleData } = await svc
          .from("user_roles")
          .select("is_superadmin, is_admin_expedientes")
          .eq("user_id", user.id)
          .maybeSingle();

        const isSuperadmin = roleData?.is_superadmin === true;
        const isAdminExp = roleData?.is_admin_expedientes === true;

        if (!isSuperadmin && !isAdminExp) {
          return NextResponse.json(
            { error: "No autorizado para este expediente" },
            { status: 403 }
          );
        }
      }
    }

    // Verificar si ya existe una orden para este case_ref/expediente_id
    let ordenId: string | null = null;
    let ordenExistente: any = null;

    if (expedienteId) {
      const { data: ordenExistenteData } = await svc
        .from("ordenes_medicas")
        .select("id, estado")
        .eq("expediente_id", expedienteId)
        .eq("case_ref", caseRef.trim())
        .maybeSingle();
      
      if (ordenExistenteData) {
        ordenId = ordenExistenteData.id;
        ordenExistente = ordenExistenteData;
      }
    } else {
      // Si no hay expediente_id, buscar solo por case_ref
      const { data: ordenExistenteData } = await svc
        .from("ordenes_medicas")
        .select("id, estado")
        .eq("case_ref", caseRef.trim())
        .is("expediente_id", null)
        .maybeSingle();
      
      if (ordenExistenteData) {
        ordenId = ordenExistenteData.id;
        ordenExistente = ordenExistenteData;
      }
    }

    // Si no existe orden, crear una nueva
    if (!ordenId) {
      ordenId = crypto.randomUUID();
      const { data: ordenData, error: ordenError } = await svc
        .from("ordenes_medicas")
        .insert({
          id: ordenId,
          case_ref: caseRef.trim(),
          expediente_id: expedienteId || null,
          storage_path: "", // Ya no se usa, se guarda en ordenes_medicas_archivos
          filename: files[0]?.name || "",
          mime: files[0]?.type || "application/pdf",
          size: files.reduce((sum, f) => sum + f.size, 0),
          emitida_por_user_id: user.id,
          estado: "NUEVA",
        })
        .select()
        .single();

      if (ordenError) {
        console.error("Error creando orden:", ordenError);
        return NextResponse.json(
          { error: "Error al crear la orden: " + ordenError.message },
          { status: 500 }
        );
      }
      ordenExistente = ordenData;
    }

    // Verificar cuántos archivos ya tiene la orden
    const { data: archivosExistentes } = await svc
      .from("ordenes_medicas_archivos")
      .select("orden_archivo")
      .eq("orden_id", ordenId);

    const archivosExistentesCount = archivosExistentes?.length || 0;
    const espaciosDisponibles = 5 - archivosExistentesCount;

    if (files.length > espaciosDisponibles) {
      return NextResponse.json(
        { error: `Solo puedes agregar ${espaciosDisponibles} archivo(s) más. Máximo 5 archivos por orden.` },
        { status: 400 }
      );
    }

    // Subir todos los archivos
    const archivosSubidos: any[] = [];
    const archivosAEliminar: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ordenArchivo = archivosExistentesCount + i + 1;
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const storagePath = `ordenes-medicas/${user.id}/${ordenId}/${ordenArchivo}.${fileExt}`;

      // Subir archivo a Supabase Storage
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await svc.storage
        .from("ordenes-medicas")
        .upload(storagePath, fileBuffer, {
          contentType: file.type || "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        // Si falla, eliminar archivos ya subidos
        for (const path of archivosAEliminar) {
          await svc.storage.from("ordenes-medicas").remove([path]);
        }
        console.error("Error subiendo archivo:", uploadError);
        return NextResponse.json(
          { error: `Error al subir el archivo ${file.name}: ${uploadError.message}` },
          { status: 500 }
        );
      }

      archivosAEliminar.push(storagePath);

      // Crear registro en ordenes_medicas_archivos
      const { data: archivoData, error: archivoError } = await svc
        .from("ordenes_medicas_archivos")
        .insert({
          orden_id: ordenId,
          storage_path: storagePath,
          filename: file.name,
          mime: file.type || "application/pdf",
          size: file.size,
          orden_archivo: ordenArchivo,
        })
        .select()
        .single();

      if (archivoError) {
        // Si falla, eliminar archivo subido
        await svc.storage.from("ordenes-medicas").remove([storagePath]);
        console.error("Error creando registro de archivo:", archivoError);
        return NextResponse.json(
          { error: `Error al registrar el archivo ${file.name}: ${archivoError.message}` },
          { status: 500 }
        );
      }

      archivosSubidos.push(archivoData);
    }

    // Crear gestión_estudio inicial con estado PENDIENTE_CONTACTO_CLIENTE
    // Buscar usuario "Andrea" o usar el usuario actual
    let responsableUserId = user.id;
    try {
      const { data: andreaProfile } = await svc
        .from("profiles")
        .select("id")
        .or("full_name.ilike.%andrea%,email.ilike.%andrea%")
        .limit(1)
        .maybeSingle();

      if (andreaProfile) {
        responsableUserId = andreaProfile.id;
      }
    } catch (e) {
      // Si no se encuentra Andrea, usar usuario actual
      console.log("No se encontró usuario Andrea, usando usuario actual");
    }

    const { error: gestionError } = await svc
      .from("gestiones_estudio")
      .insert({
        orden_id: ordenId,
        estado: "PENDIENTE_CONTACTO_CLIENTE",
        responsable_user_id: responsableUserId,
      });

    if (gestionError) {
      console.error("Error creando gestión:", gestionError);
      // No fallar, solo loguear el error
    }

    // Si es una orden nueva, crear gestión_estudio inicial
    let gestionCreada = false;
    if (!ordenExistente || ordenExistente.estado === "NUEVA") {
      // Buscar usuario "Andrea" o usar el usuario actual
      let responsableUserId = user.id;
      try {
        const { data: andreaProfile } = await svc
          .from("profiles")
          .select("id")
          .or("full_name.ilike.%andrea%,email.ilike.%andrea%")
          .limit(1)
          .maybeSingle();

        if (andreaProfile) {
          responsableUserId = andreaProfile.id;
        }
      } catch (e) {
        console.log("No se encontró usuario Andrea, usando usuario actual");
      }

      // Verificar si ya existe una gestión
      const { data: gestionExistente } = await svc
        .from("gestiones_estudio")
        .select("id")
        .eq("orden_id", ordenId)
        .maybeSingle();

      if (!gestionExistente) {
        const { error: gestionError } = await svc
          .from("gestiones_estudio")
          .insert({
            orden_id: ordenId,
            estado: "PENDIENTE_CONTACTO_CLIENTE",
            responsable_user_id: responsableUserId,
          });

        if (!gestionError) {
          gestionCreada = true;
        } else {
          console.error("Error creando gestión:", gestionError);
        }
      }
    }

    // Obtener la orden actualizada con todos sus archivos
    const { data: ordenActualizada } = await svc
      .from("ordenes_medicas")
      .select(`
        *,
        archivos:ordenes_medicas_archivos (
          id,
          storage_path,
          filename,
          mime,
          size,
          orden_archivo
        )
      `)
      .eq("id", ordenId)
      .single();

    return NextResponse.json({
      ok: true,
      data: ordenActualizada || ordenExistente,
      archivos_subidos: archivosSubidos.length,
      gestion_creada: gestionCreada,
      orden_existente: !!ordenExistente,
    });
  } catch (e: any) {
    console.error("Error en upload:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
