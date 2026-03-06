import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

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

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { transferId, newRecipientUserId, message } = body;

    if (!transferId) {
      return NextResponse.json({ error: "Falta transferId" }, { status: 400 });
    }

    if (!newRecipientUserId) {
      return NextResponse.json({ error: "Falta newRecipientUserId" }, { status: 400 });
    }

    if (newRecipientUserId === user.id) {
      return NextResponse.json({ error: "No puedes redirigir a ti mismo" }, { status: 400 });
    }

    const svc = supabaseService();

    // 1) Verificar que el usuario actual es el recipient del transfer original
    const { data: originalTransfer, error: transferError } = await svc
      .from("file_transfers")
      .select("id, sender_user_id, recipient_user_id, doc_type, title")
      .eq("id", transferId)
      .single();

    if (transferError || !originalTransfer) {
      return NextResponse.json({ error: "Transferencia no encontrada" }, { status: 404 });
    }

    if (originalTransfer.recipient_user_id !== user.id) {
      return NextResponse.json({ error: "Solo puedes redirigir documentos que recibiste" }, { status: 403 });
    }

    // 2) Obtener la última versión del archivo original
    const { data: latestVersion, error: versionError } = await svc
      .from("file_transfer_versions")
      .select("storage_path, version")
      .eq("transfer_id", transferId)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    if (versionError || !latestVersion?.storage_path) {
      return NextResponse.json({ error: "No se encontró el archivo original" }, { status: 404 });
    }

    // 3) Descargar el archivo original desde storage
    const { data: fileData, error: downloadError } = await svc.storage
      .from("transfers")
      .download(latestVersion.storage_path);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "No se pudo descargar el archivo original" }, { status: 500 });
    }

    const fileBuffer = Buffer.from(await fileData.arrayBuffer());
    
    // Determinar la extensión del archivo desde el storage_path
    const ext = latestVersion.storage_path.match(/\.(\w+)$/)?.[1] || "docx";
    const contentType = ext === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : ext === "pdf"
      ? "application/pdf"
      : ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : "application/zip";

    // 4) Crear nueva transferencia al nuevo destinatario
    const { data: newTransfer, error: newTransferError } = await svc
      .from("file_transfers")
      .insert({
        sender_user_id: user.id,
        recipient_user_id: newRecipientUserId,
        doc_type: originalTransfer.doc_type,
        title: originalTransfer.title ? `Re: ${originalTransfer.title}` : null,
      })
      .select("id")
      .single();

    if (newTransferError || !newTransfer?.id) {
      return NextResponse.json({ error: "No se pudo crear la nueva transferencia" }, { status: 500 });
    }

    const newTransferId = newTransfer.id as string;
    const newVersion = 1;

    // 5) Subir el archivo a la nueva transferencia
    const newStoragePath = `transfers/${newTransferId}/v${newVersion}.${ext}`;

    const { error: uploadError } = await svc.storage
      .from("transfers")
      .upload(newStoragePath, fileBuffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: `No se pudo subir el archivo: ${uploadError.message}` }, { status: 500 });
    }

    // 6) Crear versión en la base de datos
    const { error: versionInsertError } = await svc
      .from("file_transfer_versions")
      .insert({
        transfer_id: newTransferId,
        version: newVersion,
        storage_path: newStoragePath,
        created_by: user.id,
      });

    if (versionInsertError) {
      return NextResponse.json({ error: versionInsertError.message }, { status: 500 });
    }

    // 7) Obtener información de usuarios para las notificaciones
    const { data: currentUserProfile } = await svc
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    const { data: originalSenderProfile } = await svc
      .from("profiles")
      .select("full_name, email")
      .eq("id", originalTransfer.sender_user_id)
      .single();

    const { data: newRecipientProfile } = await svc
      .from("profiles")
      .select("full_name, email")
      .eq("id", newRecipientUserId)
      .single();

    const currentUserName =
      (currentUserProfile?.full_name || "").trim() ||
      (currentUserProfile?.email || "").trim() ||
      "Usuario";

    const originalSenderName =
      (originalSenderProfile?.full_name || "").trim() ||
      (originalSenderProfile?.email || "").trim() ||
      "Usuario";

    const newRecipientName =
      (newRecipientProfile?.full_name || "").trim() ||
      (newRecipientProfile?.email || "").trim() ||
      "Usuario";

    const tipoTxt = originalTransfer.doc_type === "CEDULA" ? "Cédula" : originalTransfer.doc_type === "OFICIO" ? "Oficio" : "Otros Escritos";

    // 8) Crear notificación para el nuevo destinatario
    const notificationTitle = originalTransfer.title 
      ? `${tipoTxt}: ${originalTransfer.title}` 
      : `${tipoTxt} redirigida`;
    
    await svc.from("notifications").insert({
      user_id: newRecipientUserId,
      title: notificationTitle,
      body: `${currentUserName} te redirigió un ${tipoTxt.toLowerCase()}${originalTransfer.title ? `: "${originalTransfer.title}"` : ""}${message ? `. Mensaje: ${message}` : ""}`,
      link: `/app/recibidos`,
      metadata: {
        transfer_id: newTransferId,
        sender_id: user.id,
        doc_type: originalTransfer.doc_type,
        title: originalTransfer.title || null,
        redirected_from: originalTransfer.sender_user_id,
      },
    });

    // 9) Crear notificación de respuesta para el remitente original
    const replyMessage = message 
      ? `${currentUserName} redirigió tu ${tipoTxt.toLowerCase()} a ${newRecipientName}. Mensaje: ${message}`
      : `${currentUserName} redirigió tu ${tipoTxt.toLowerCase()} a ${newRecipientName}`;

    await svc.from("notifications").insert({
      user_id: originalTransfer.sender_user_id,
      title: `Re: ${notificationTitle}`,
      body: replyMessage,
      link: `/app/recibidos`,
      metadata: {
        transfer_id: newTransferId,
        sender_id: user.id,
        doc_type: originalTransfer.doc_type,
        title: originalTransfer.title || null,
        redirected_to: newRecipientUserId,
        original_transfer_id: transferId,
      },
    });

    return NextResponse.json({ 
      ok: true, 
      newTransferId,
      message: "Documento redirigido exitosamente" 
    });
  } catch (e: any) {
    console.error("Error en redirect:", e);
    return NextResponse.json({ error: e?.message || "Error desconocido" }, { status: 500 });
  }
}
