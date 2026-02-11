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

    // Verificar si es FormData (con archivo) o JSON (sin archivo)
    const contentType = req.headers.get("content-type") || "";
    let parent_notification_id: string;
    let message: string;
    let expediente_id: string | undefined;
    let is_pjn_favorito: boolean | undefined;
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      // Es FormData con archivo
      const form = await req.formData();
      parent_notification_id = String(form.get("parent_notification_id") || "");
      message = String(form.get("message") || "").trim();
      const expId = form.get("expediente_id");
      expediente_id = expId ? String(expId) : undefined;
      const isPjn = form.get("is_pjn_favorito");
      is_pjn_favorito = isPjn ? String(isPjn) === "true" : undefined;
      const fileData = form.get("file");
      if (fileData instanceof File) {
        file = fileData;
      }
    } else {
      // Es JSON sin archivo
      const body = await req.json();
      parent_notification_id = body.parent_notification_id;
      message = body.message?.trim() || "";
      expediente_id = body.expediente_id;
      is_pjn_favorito = body.is_pjn_favorito;
    }

    if (!parent_notification_id || !message) {
      return NextResponse.json(
        { error: "parent_notification_id y message son requeridos" },
        { status: 400 }
      );
    }

    // Validar archivo si está presente
    if (file) {
      const name = (file.name || "").toLowerCase();
      if (!name.endsWith(".docx")) {
        return NextResponse.json(
          { error: "Solo se permite .docx como archivo adjunto" },
          { status: 400 }
        );
      }
    }

    const svc = supabaseService();

    // Obtener la notificación padre para obtener el thread_id y metadata
    const { data: parentNotif, error: parentError } = await svc
      .from("notifications")
      .select("id, user_id, thread_id, expediente_id, is_pjn_favorito, metadata, title, link")
      .eq("id", parent_notification_id)
      .single();

    if (parentError || !parentNotif) {
      return NextResponse.json(
        { error: "Notificación padre no encontrada" },
        { status: 404 }
      );
    }

    // Determinar el thread_id (si el padre tiene thread_id, usarlo; si no, usar el id del padre)
    const threadId = parentNotif.thread_id || parentNotif.id;

    // Obtener información del usuario que responde
    const { data: senderProfile } = await svc
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    const senderName = senderProfile?.full_name || senderProfile?.email || "Un usuario";

    // Determinar a quién enviar la respuesta:
    // La respuesta debe ir al remitente original (quien mencionó), no al destinatario
    // El remitente original está guardado en metadata.sender_id de la notificación padre
    
    let parentMetadata = parentNotif.metadata;
    if (typeof parentMetadata === 'string') {
      try {
        parentMetadata = JSON.parse(parentMetadata);
      } catch (e) {
        console.error("[API reply] Error parseando metadata:", e);
        parentMetadata = {};
      }
    }
    
    // Obtener sender_id del metadata (quien creó la mención original)
    const senderIdFromMetadata = (parentMetadata as any)?.sender_id;
    
    // Si no hay sender_id en el metadata, buscar en la notificación original del thread
    let recipientId: string | null = senderIdFromMetadata || null;
    
    if (!recipientId) {
      // Buscar la notificación original del thread (la primera, sin parent_id)
      if (threadId) {
        const { data: originalNotif } = await svc
          .from("notifications")
          .select("id, user_id, metadata")
          .eq("thread_id", threadId)
          .is("parent_id", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        
        if (originalNotif) {
          let originalMetadata = originalNotif.metadata;
          if (typeof originalMetadata === 'string') {
            try {
              originalMetadata = JSON.parse(originalMetadata);
            } catch (e) {
              originalMetadata = {};
            }
          }
          
          const originalSenderId = (originalMetadata as any)?.sender_id;
          if (originalSenderId) {
            recipientId = originalSenderId;
          }
        }
      }
    }
    
    // Si aún no tenemos recipientId, significa que es una notificación antigua sin sender_id
    // En este caso, NO podemos determinar el remitente original, así que NO creamos la notificación
    // o la creamos para el user_id del padre (pero esto no es ideal)
    if (!recipientId) {
      // Para notificaciones antiguas sin sender_id, no podemos determinar el remitente
      // Devolver error explicativo
      return NextResponse.json(
        { 
          error: "No se pudo determinar el remitente original. Esta notificación es antigua y no tiene la información necesaria.",
          suggestion: "Crea una nueva mención para poder responder correctamente."
        },
        { status: 400 }
      );
    }
    
    // Verificar que el recipientId no sea el mismo que quien está respondiendo
    if (recipientId === user.id) {
      return NextResponse.json(
        { error: "No puedes responder a tu propia mención" },
        { status: 400 }
      );
    }

    // Si hay un archivo adjunto y la notificación padre es de transferencia, crear una nueva transferencia
    let transferId: string | null = null;
    if (file && parentNotif.link === "/app/recibidos") {
      // Obtener el transfer_id original del metadata
      let originalTransferId: string | null = null;
      
      // Intentar obtener el transfer_id del metadata
      if (parentMetadata && typeof parentMetadata === 'object') {
        originalTransferId = (parentMetadata as any)?.transfer_id || null;
      }
      
      // Si no hay transfer_id en metadata, buscar la transferencia más reciente entre el remitente y el destinatario
      // Esto es un fallback para notificaciones antiguas que no tienen transfer_id en metadata
      if (!originalTransferId) {
        const { data: recentTransfer } = await svc
          .from("file_transfers")
          .select("id, doc_type")
          .or(`and(sender_user_id.eq.${recipientId},recipient_user_id.eq.${user.id}),and(sender_user_id.eq.${user.id},recipient_user_id.eq.${recipientId})`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (recentTransfer) {
          originalTransferId = recentTransfer.id;
        }
      }
      
      // Determinar el tipo de documento (CEDULA u OFICIO) basado en el título de la notificación padre
      let docType: "CEDULA" | "OFICIO" = "CEDULA";
      if (parentNotif.title.toLowerCase().includes("oficio")) {
        docType = "OFICIO";
      } else if (originalTransferId) {
        // Intentar obtener el tipo del transfer original
        const { data: originalTransfer } = await svc
          .from("file_transfers")
          .select("doc_type")
          .eq("id", originalTransferId)
          .single();
        if (originalTransfer) {
          docType = originalTransfer.doc_type as "CEDULA" | "OFICIO";
        }
      }
      
      // Crear nueva transferencia
      const { data: newTransfer, error: transferError } = await svc
        .from("file_transfers")
        .insert({
          sender_user_id: user.id,
          recipient_user_id: recipientId,
          doc_type: docType,
          title: `Re: ${parentNotif.title}`,
        })
        .select("id")
        .single();
      
      if (transferError || !newTransfer?.id) {
        console.error("[API reply] Error al crear transferencia:", transferError);
        return NextResponse.json(
          { error: "No se pudo crear la transferencia del archivo adjunto" },
          { status: 500 }
        );
      }
      
      transferId = newTransfer.id;
      const version = 1;
      
      // Subir archivo a storage
      const buf = Buffer.from(await file.arrayBuffer());
      const storage_path = `transfers/${transferId}/v${version}.docx`;
      
      const { error: upErr } = await svc.storage
        .from("transfers")
        .upload(storage_path, buf, {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: true,
        });
      
      if (upErr) {
        console.error("[API reply] Error al subir archivo:", upErr);
        return NextResponse.json(
          { error: `No se pudo subir el archivo: ${upErr.message}` },
          { status: 500 }
        );
      }
      
      // Insertar versión
      const { error: vErr } = await svc
        .from("file_transfer_versions")
        .insert({
          transfer_id: transferId,
          version,
          storage_path,
          created_by: user.id,
        });
      
      if (vErr) {
        console.error("[API reply] Error al crear versión:", vErr);
        return NextResponse.json(
          { error: vErr.message },
          { status: 500 }
        );
      }
      
      console.log("[API reply] Transferencia creada exitosamente:", transferId);
    }

    // Crear la respuesta como nueva notificación
    const replyMetadata = {
      ...(parentMetadata as object || {}),
      sender_id: user.id, // El remitente de la respuesta es quien responde
      transfer_id: transferId || undefined, // Incluir transfer_id si se creó una transferencia
    };

    // Construir el link al expediente/cédula (usar el mismo que el padre si existe)
    let replyLink = null;
    if (parentNotif.expediente_id || parentNotif.link) {
      const isPjn = is_pjn_favorito !== undefined ? is_pjn_favorito : parentNotif.is_pjn_favorito;
      const expId = expediente_id || parentNotif.expediente_id;
      
      // Verificar si es una cédula usando metadata
      let parentMetadata = parentNotif.metadata;
      if (typeof parentMetadata === 'string') {
        try {
          parentMetadata = JSON.parse(parentMetadata);
        } catch (e) {
          parentMetadata = {};
        }
      }
      const isCedula = (parentMetadata as any)?.cedula_id || false;
      
      if (isPjn) {
        replyLink = `/superadmin/mis-juzgados#pjn_${expId}`;
      } else if (isCedula) {
        // Para cédulas, el link debe apuntar a /app#cedula_id
        const cedulaId = (parentMetadata as any)?.cedula_id || expId;
        replyLink = `/app#${cedulaId}`;
      } else {
        replyLink = `/superadmin/mis-juzgados#${expId}`;
      }
    } else if (parentNotif.link) {
      // Si no hay expediente_id pero hay link, usar el link del padre
      replyLink = parentNotif.link;
    }
    
    // Si se creó una transferencia, el link debe apuntar a /app/recibidos
    if (transferId) {
      replyLink = "/app/recibidos";
    }

    // Asegurar que el mensaje no esté vacío
    const messageTrimmed = (message || "").trim();
    if (!messageTrimmed) {
      return NextResponse.json(
        { error: "El mensaje no puede estar vacío" },
        { status: 400 }
      );
    }

    console.log("[API reply] Creando notificación de respuesta:", {
      user_id: recipientId,
      sender_id: user.id,
      sender_name: senderName,
      title: `Re: ${parentNotif.title}`,
      thread_id: threadId,
      link: replyLink,
      message: messageTrimmed,
      message_length: messageTrimmed.length,
      transfer_id: transferId,
      has_file: !!file
    });

    const { data: replyNotif, error: replyError } = await svc
      .from("notifications")
      .insert({
        user_id: recipientId, // Notificar al remitente original (quien mencionó)
        title: `Re: ${parentNotif.title}`,
        body: file 
          ? `${senderName} respondió con archivo adjunto: ${messageTrimmed}`
          : `${senderName} respondió: ${messageTrimmed}`,
        link: replyLink,
        parent_id: parent_notification_id,
        thread_id: threadId,
        expediente_id: expediente_id || parentNotif.expediente_id,
        is_pjn_favorito: is_pjn_favorito !== undefined ? is_pjn_favorito : parentNotif.is_pjn_favorito,
        metadata: replyMetadata,
        nota_context: messageTrimmed, // Guardar el mensaje como contexto (asegurar que no esté vacío)
        is_read: false,
      })
      .select()
      .single();

    if (replyError) {
      console.error("[API reply] Error al crear respuesta:", replyError);
      return NextResponse.json(
        { error: replyError.message || "Error al crear respuesta" },
        { status: 500 }
      );
    }

    console.log("[API reply] Notificación de respuesta creada exitosamente:", {
      id: replyNotif?.id,
      user_id: replyNotif?.user_id,
      recipient_id: recipientId,
      sender_id: user.id,
      title: replyNotif?.title,
      body: replyNotif?.body,
      nota_context: replyNotif?.nota_context
    });
    
    // Verificar que la notificación se creó correctamente consultando la BD
    if (replyNotif?.id) {
      const { data: verifyNotif } = await svc
        .from("notifications")
        .select("id, user_id, title, body, nota_context, is_read")
        .eq("id", replyNotif.id)
        .single();
      
      console.log("[API reply] Verificación de notificación creada:", {
        id: verifyNotif?.id,
        title: verifyNotif?.title,
        body: verifyNotif?.body,
        nota_context: verifyNotif?.nota_context,
        nota_context_length: verifyNotif?.nota_context?.length || 0
      });
      
      // Si el nota_context no se guardó correctamente, intentar actualizarlo
      if (!verifyNotif?.nota_context || verifyNotif.nota_context.trim() === "") {
        console.warn("[API reply] nota_context está vacío, intentando actualizar...");
        await svc
          .from("notifications")
          .update({ nota_context: messageTrimmed })
          .eq("id", replyNotif.id);
        console.log("[API reply] nota_context actualizado:", messageTrimmed);
      }
    }

    // Actualizar la nota del expediente/cédula con la respuesta
    // También manejar el caso de transferencias (notificaciones sin expediente_id)
    if (expediente_id || parentNotif.expediente_id) {
      const expId = expediente_id || parentNotif.expediente_id;
      const isPjn = is_pjn_favorito !== undefined ? is_pjn_favorito : parentNotif.is_pjn_favorito;

      // Verificar si es una cédula usando metadata
      let parentMetadata = parentNotif.metadata;
      if (typeof parentMetadata === 'string') {
        try {
          parentMetadata = JSON.parse(parentMetadata);
        } catch (e) {
          parentMetadata = {};
        }
      }
      const isCedula = (parentMetadata as any)?.cedula_id || false;

      try {
        if (isPjn) {
          // Para favoritos PJN
          const pjnId = expId.replace(/^pjn_/, "");
          const { data: pjnFav } = await svc
            .from("pjn_favoritos")
            .select("notas")
            .eq("id", pjnId)
            .single();

          if (pjnFav) {
            const fechaHora = new Date().toLocaleString("es-AR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const nuevaNota = `${pjnFav.notas || ""}\n\n[${fechaHora}] ${senderName}: ${messageTrimmed}`.trim();
            
            await svc
              .from("pjn_favoritos")
              .update({ notas: nuevaNota })
              .eq("id", pjnId);
          }
        } else if (isCedula) {
          // Para cédulas/oficios
          const cedulaId = (parentMetadata as any)?.cedula_id || expId;
          const { data: cedula } = await svc
            .from("cedulas")
            .select("notas")
            .eq("id", cedulaId)
            .single();

          if (cedula) {
            const fechaHora = new Date().toLocaleString("es-AR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const nuevaNota = `${cedula.notas || ""}\n\n[${fechaHora}] ${senderName}: ${messageTrimmed}`.trim();
            
            await svc
              .from("cedulas")
              .update({ notas: nuevaNota })
              .eq("id", cedulaId);
          }
        } else {
          // Para expedientes locales
          const { data: exp } = await svc
            .from("expedientes")
            .select("notas")
            .eq("id", expId)
            .single();

          if (exp) {
            const fechaHora = new Date().toLocaleString("es-AR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const nuevaNota = `${exp.notas || ""}\n\n[${fechaHora}] ${senderName}: ${messageTrimmed}`.trim();
            
            await svc
              .from("expedientes")
              .update({ notas: nuevaNota })
              .eq("id", expId);
          }
        }
      } catch (updateError) {
        console.error("Error al actualizar notas:", updateError);
        // No fallar si no se puede actualizar, la respuesta ya se creó
      }
    } else if (parentNotif.link && parentNotif.link === "/app/recibidos") {
      // Es una notificación de transferencia (Cédula/Oficio enviado)
      // En este caso, el mensaje ya está guardado en nota_context de la notificación de respuesta
      // No hay una cédula/oficio existente para actualizar, pero el mensaje se puede ver en la notificación
      console.log("[API reply] Respuesta a transferencia - mensaje guardado en nota_context:", messageTrimmed);
      if (transferId) {
        console.log("[API reply] Transferencia creada para respuesta:", transferId);
      }
    }

    return NextResponse.json({ ok: true, data: replyNotif });
  } catch (e: any) {
    console.error("Error en reply:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
