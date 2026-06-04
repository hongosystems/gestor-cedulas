import { NextResponse } from "next/server";
import { composeMailboxMessage, ensureMailboxThreadFromLegacy } from "@/lib/mailbox-service";
import { supabaseService } from "@/lib/supabase-server";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;
    const { id: messageId } = await ctx.params;

    const body = await req.json();
    const to: string[] = body.to || [];
    const cc: string[] = body.cc || [];
    const bcc: string[] = body.bcc || [];
    const messageText = String(body.body || "").trim();
    const includeAttachments = body.include_attachments !== false;

    if (!to.length) {
      return NextResponse.json({ error: "Faltan destinatarios" }, { status: 400 });
    }

    const svc = supabaseService();
    let { data: srcMsg } = await svc
      .from("mailbox_messages")
      .select("*, mailbox_threads(*)")
      .eq("id", messageId)
      .maybeSingle();

    if (!srcMsg) {
      await ensureMailboxThreadFromLegacy(user!.id, messageId);
      const { data: imported } = await svc
        .from("mailbox_messages")
        .select("*, mailbox_threads(*)")
        .eq("legacy_transfer_id", messageId)
        .maybeSingle();
      srcMsg = imported;
    }

    if (!srcMsg) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const thread = (srcMsg as { mailbox_threads: Record<string, unknown> }).mailbox_threads;
    const subject = thread?.subject
      ? `Fwd: ${thread.subject}`
      : "Fwd: sin asunto";

    const result = await composeMailboxMessage(user!.id, {
      subject,
      body: messageText || srcMsg.body,
      docType: (thread?.doc_type as "CEDULA") || undefined,
      expedienteRef: (thread?.expediente_ref as string) || null,
      to,
      cc,
      bcc,
      forwardedFromMessageId: srcMsg.id,
    });

    if (includeAttachments) {
      const { data: atts } = await svc
        .from("mailbox_attachments")
        .select("*")
        .eq("message_id", srcMsg.id)
        .order("version", { ascending: false })
        .limit(1);
      const att = atts?.[0];
      if (att) {
        const srcBucket = att.storage_path?.startsWith("transfers/") ? "transfers" : "mailbox";
        const { data: fileData } = await svc.storage.from(srcBucket).download(att.storage_path);
        if (fileData) {
          const buf = Buffer.from(await fileData.arrayBuffer());
          const newId = crypto.randomUUID();
          const ext = att.file_name.includes(".") ? att.file_name.slice(att.file_name.lastIndexOf(".")) : "";
          const storage_path = `mailbox/${result.messageId}/${newId}/v1${ext}`;
          await svc.storage.from("mailbox").upload(storage_path, buf, {
            contentType: att.content_type || "application/octet-stream",
            upsert: true,
          });
          await svc.from("mailbox_attachments").insert({
            id: newId,
            message_id: result.messageId,
            storage_path,
            file_name: att.file_name,
            content_type: att.content_type,
            size_bytes: att.size_bytes,
            version: 1,
            uploaded_by: user!.id,
          });
        }
      }
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mailboxError(e, 400);
  }
}
