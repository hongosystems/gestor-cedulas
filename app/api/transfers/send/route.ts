import { NextResponse } from "next/server";
import { importFileTransferToMailbox } from "@/lib/mailbox-service";
import { supabaseService } from "@/lib/supabase-server";
import { userHasMailboxWorkflow } from "@/lib/unread-notifications";
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

    const {
      data: { user },
      error,
    } = await supabaseClient.auth.getUser(token);

    if (error || !user) {
      console.error("Auth error:", error?.message);
      return null;
    }

    return user;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Error getting user:", message);
    return null;
  }
}

async function resolveExpedienteMeta(
  svc: ReturnType<typeof supabaseService>,
  expediente_ref: string | null
) {
  let expedienteData: {
    caratula?: string;
    juzgado?: string;
    numero?: string;
  } = {};

  if (!expediente_ref) {
    return { expedienteData, expediente_caratula: null, expediente_juzgado: null };
  }

  const parts = expediente_ref.split("/");
  if (parts.length === 2) {
    const [numero, anio] = parts;
    const { data: favData } = await svc
      .from("pjn_favoritos")
      .select("caratula, juzgado, numero, anio")
      .eq("numero", numero.trim())
      .eq("anio", anio.trim())
      .limit(1)
      .maybeSingle();
    if (favData) {
      expedienteData = {
        caratula: favData.caratula || undefined,
        juzgado: favData.juzgado || undefined,
        numero: `${favData.numero}/${favData.anio}`,
      };
    }
  }

  return {
    expedienteData,
    expediente_caratula: expedienteData.caratula ?? null,
    expediente_juzgado: expedienteData.juzgado ?? null,
  };
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const recipient_user_id = String(form.get("recipient_user_id") || "");
    const doc_type = String(form.get("doc_type") || "");
    const title = String(form.get("title") || "").trim();
    const message = String(form.get("message") || "").trim();
    const expediente_ref = String(form.get("expediente_ref") || "").trim() || null;
    const file = form.get("file");
    const hasFile = file instanceof File && (file.size ?? 0) > 0;

    if (!recipient_user_id) {
      return NextResponse.json({ error: "Falta recipient_user_id" }, { status: 400 });
    }
    if (doc_type !== "CEDULA" && doc_type !== "OFICIO" && doc_type !== "OTROS_ESCRITOS") {
      return NextResponse.json({ error: "doc_type inválido" }, { status: 400 });
    }
    if (!message && !hasFile) {
      return NextResponse.json(
        { error: "Debés incluir un mensaje o un archivo adjunto" },
        { status: 400 }
      );
    }

    let ext: string | null = null;
    let contentType: string | null = null;

    if (hasFile && file instanceof File) {
      const name = (file.name || "").toLowerCase();
      const allowedExts = [".docx", ".pdf", ".png", ".jpg", ".jpeg", ".zip"];
      ext = allowedExts.find((e) => name.endsWith(e)) ?? null;

      if (!ext) {
        return NextResponse.json(
          { error: "Solo se permite .docx, .pdf, .png, .jpg, .jpeg o .zip" },
          { status: 400 }
        );
      }

      contentType =
        ext === ".docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : ext === ".pdf"
            ? "application/pdf"
            : ext === ".png"
              ? "image/png"
              : ext === ".jpg" || ext === ".jpeg"
                ? "image/jpeg"
                : "application/zip";
    }

    const svc = supabaseService();
    const { expedienteData, expediente_caratula, expediente_juzgado } =
      await resolveExpedienteMeta(svc, expediente_ref);

    const insertPayload: Record<string, unknown> = {
      sender_user_id: user.id,
      recipient_user_id,
      doc_type,
      title: title || null,
      expediente_ref,
      message: message || null,
      expediente_caratula,
      expediente_juzgado,
    };

    const { data: t, error: tErr } = await svc
      .from("file_transfers")
      .insert(insertPayload)
      .select("id")
      .single();

    if (tErr || !t?.id) {
      const hint =
        tErr?.message?.includes("message") || tErr?.message?.includes("column")
          ? " (¿Ejecutaste migrations/add_file_transfers_message.sql en Supabase?)"
          : "";
      return NextResponse.json(
        { error: (tErr?.message || "No se pudo crear el envío") + hint },
        { status: 500 }
      );
    }

    const transferId = t.id as string;

    if (hasFile && file instanceof File && ext && contentType) {
      const version = 1;
      const buf = Buffer.from(await file.arrayBuffer());
      const storage_path = `transfers/${transferId}/v${version}${ext}`;

      const { error: upErr } = await svc.storage.from("transfers").upload(storage_path, buf, {
        contentType,
        upsert: true,
      });

      if (upErr) {
        return NextResponse.json(
          { error: `No se pudo subir el archivo: ${upErr.message}` },
          { status: 500 }
        );
      }

      const { error: vErr } = await svc.from("file_transfer_versions").insert({
        transfer_id: transferId,
        version,
        storage_path,
        created_by: user.id,
      });

      if (vErr) {
        return NextResponse.json({ error: vErr.message }, { status: 500 });
      }
    }

    const { data: senderProfile } = await svc
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    const senderName =
      (senderProfile?.full_name || "").trim() ||
      (senderProfile?.email || "").trim() ||
      "Usuario";

    const tipoTxt =
      doc_type === "CEDULA" ? "Cédula" : doc_type === "OFICIO" ? "Oficio" : "Causas Penales";

    const notificationTitle = title
      ? `${tipoTxt}: ${title}`
      : message
        ? `Mensaje: ${message.slice(0, 60)}${message.length > 60 ? "…" : ""}`
        : `${tipoTxt} nueva`;

    let notificationBody = `${senderName} te envió`;
    if (hasFile && message) {
      notificationBody += ` un ${tipoTxt.toLowerCase()} con mensaje`;
    } else if (hasFile) {
      notificationBody += ` un ${tipoTxt.toLowerCase()}`;
    } else {
      notificationBody += ` un mensaje`;
    }
    if (title) notificationBody += `: "${title}"`;
    else if (message && !title) {
      const preview = message.length > 140 ? `${message.slice(0, 140)}…` : message;
      notificationBody += `. ${preview}`;
    }
    if (hasFile) {
      notificationBody += ' Abrí Recibidos para ver el contenido o descargar el adjunto.';
    } else {
      notificationBody += " Abrí Recibidos para leer el mensaje.";
    }

    try {
      await importFileTransferToMailbox(svc, transferId);
    } catch (importErr) {
      console.error("No se pudo importar transfer a mailbox:", importErr);
    }

    const recipientWorkflow = await userHasMailboxWorkflow(recipient_user_id);

    if (recipientWorkflow) {
      return NextResponse.json({ ok: true, transferId, hasAttachment: hasFile });
    }

    await svc.from("notifications").insert({
      user_id: recipient_user_id,
      title: notificationTitle,
      body: notificationBody,
      link: expediente_ref ? `/superadmin/mis-juzgados` : `/app/documentos?tab=recibidos`,
      metadata: {
        transfer_id: transferId,
        sender_id: user.id,
        doc_type,
        title: title || null,
        message: message || null,
        has_attachment: hasFile,
        ...(expedienteData.caratula ? { caratula: expedienteData.caratula } : {}),
        ...(expedienteData.juzgado ? { juzgado: expedienteData.juzgado } : {}),
        ...(expedienteData.numero ? { numero: expedienteData.numero } : {}),
        ...(expediente_ref ? { case_ref: expediente_ref, expediente_ref } : {}),
      },
    });

    return NextResponse.json({ ok: true, transferId, hasAttachment: hasFile });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
