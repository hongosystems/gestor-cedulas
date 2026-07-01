import { NextResponse } from "next/server";
import { importFileTransferToMailbox } from "@/lib/mailbox-service";
import { supabaseService } from "@/lib/supabase-server";
import {
  contentTypeForTransferExt,
  extFromTransferFileName,
  transferAttachmentStoragePath,
} from "@/lib/transfer-attachments";
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

    if (!url || !anon) return null;

    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error,
    } = await supabaseClient.auth.getUser(token);

    if (error || !user) return null;
    return user;
  } catch {
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
    const cedulaId = String(body.cedula_id || "").trim();
    const recipientIds = Array.isArray(body.recipient_user_ids)
      ? [...new Set(body.recipient_user_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean))]
      : [];
    const expedienteRef = String(body.expediente_ref || "").trim() || null;
    const fileName = String(body.file_name || "").trim() || "documento.pdf";

    if (!cedulaId) {
      return NextResponse.json({ error: "cedula_id requerido" }, { status: 400 });
    }
    if (recipientIds.length === 0) {
      return NextResponse.json({ ok: true, shared: 0 });
    }

    const svc = supabaseService();

    const { data: cedula, error: cedulaErr } = await svc
      .from("cedulas")
      .select("id, pdf_path, caratula, juzgado, tipo_documento, owner_user_id, created_by_user_id")
      .eq("id", cedulaId)
      .maybeSingle();

    if (cedulaErr || !cedula) {
      return NextResponse.json({ error: "Cédula no encontrada" }, { status: 404 });
    }

    const canShare =
      cedula.owner_user_id === user.id || cedula.created_by_user_id === user.id;
    if (!canShare) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    if (!cedula.pdf_path?.trim()) {
      return NextResponse.json({ error: "La cédula no tiene archivo adjunto" }, { status: 400 });
    }

    const { data: fileData, error: dlErr } = await svc.storage
      .from("cedulas")
      .download(cedula.pdf_path);

    if (dlErr || !fileData) {
      return NextResponse.json(
        { error: dlErr?.message || "No se pudo leer el archivo de la cédula" },
        { status: 500 }
      );
    }

    const fileBuf = Buffer.from(await fileData.arrayBuffer());
    const ext =
      extFromTransferFileName(fileName) ||
      extFromTransferFileName(cedula.pdf_path) ||
      `.${(fileName.split(".").pop() || cedula.pdf_path.split(".").pop() || "pdf").toLowerCase()}`;
    const contentType =
      ext === ".doc" ? "application/msword" : contentTypeForTransferExt(ext);
    const rawDocType = cedula.tipo_documento || "CEDULA";
    // file_transfers en algunos entornos solo admite CEDULA/OFICIO en el CHECK
    const docType =
      rawDocType === "OFICIO"
        ? "OFICIO"
        : rawDocType === "OTROS_ESCRITOS"
        ? "OTROS_ESCRITOS"
        : "CEDULA";
    const caratulaTrim = (cedula.caratula || "").trim();
    const juzgadoTrim = (cedula.juzgado || "").trim();

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
      docType === "CEDULA" ? "Cédula" : docType === "OFICIO" ? "Oficio" : "Causas Penales";

    let shared = 0;
    const errors: string[] = [];

    for (const recipientUserId of recipientIds) {
      if (recipientUserId === user.id) continue;

      const insertPayload: Record<string, unknown> = {
        sender_user_id: user.id,
        recipient_user_id: recipientUserId,
        doc_type: docType,
        title: caratulaTrim || null,
        message: null,
        expediente_ref: expedienteRef,
        expediente_caratula: caratulaTrim || null,
        expediente_juzgado: juzgadoTrim || null,
      };

      let transferId: string | null = null;
      let tErr: { message?: string } | null = null;

      const firstInsert = await svc
        .from("file_transfers")
        .insert(insertPayload)
        .select("id")
        .single();

      if (firstInsert.error || !firstInsert.data?.id) {
        if (docType === "OTROS_ESCRITOS") {
          const retry = await svc
            .from("file_transfers")
            .insert({ ...insertPayload, doc_type: "CEDULA" })
            .select("id")
            .single();
          transferId = retry.data?.id ?? null;
          tErr = retry.error;
        } else {
          tErr = firstInsert.error;
        }
      } else {
        transferId = firstInsert.data.id as string;
      }

      if (!transferId) {
        errors.push(tErr?.message || `No se pudo compartir con ${recipientUserId}`);
        continue;
      }
      const storage_path = transferAttachmentStoragePath(transferId, 1, fileName, ext);

      const { error: upErr } = await svc.storage.from("transfers").upload(storage_path, fileBuf, {
        contentType,
        upsert: true,
      });

      if (upErr) {
        errors.push(upErr.message);
        continue;
      }

      const { error: vErr } = await svc.from("file_transfer_versions").insert({
        transfer_id: transferId,
        version: 1,
        storage_path,
        created_by: user.id,
      });

      if (vErr) {
        errors.push(vErr.message);
        continue;
      }

      try {
        await importFileTransferToMailbox(svc, transferId);
      } catch (importErr) {
        console.error("[share-destinatarios] mailbox import:", importErr);
      }

      const notificationTitle = caratulaTrim
        ? `${tipoTxt}: ${caratulaTrim.substring(0, 50)}${caratulaTrim.length > 50 ? "..." : ""}`
        : `${tipoTxt} nueva`;

      const notificationBody = `${senderName} te envió un ${tipoTxt.toLowerCase()}${
        caratulaTrim ? `: "${caratulaTrim}"` : ""
      }. Abrí Recibidos para ver el contenido o descargar el adjunto.`;

      const recipientWorkflow = await userHasMailboxWorkflow(recipientUserId);

      if (!recipientWorkflow) {
        await svc.from("notifications").insert({
          user_id: recipientUserId,
          title: notificationTitle,
          body: notificationBody,
          link: `/app/documentos?tab=recibidos`,
          metadata: {
            transfer_id: transferId,
            sender_id: user.id,
            doc_type: docType,
            title: caratulaTrim || null,
            has_attachment: true,
            attachment_count: 1,
            cedula_id: cedulaId,
            ...(caratulaTrim ? { caratula: caratulaTrim } : {}),
            ...(juzgadoTrim ? { juzgado: juzgadoTrim } : {}),
            ...(expedienteRef ? { case_ref: expedienteRef, expediente_ref: expedienteRef } : {}),
          },
        });
      }

      shared++;
    }

    return NextResponse.json({
      ok: true,
      shared,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
