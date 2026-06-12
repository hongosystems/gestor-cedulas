import { NextResponse } from "next/server";
import {
  commitMailboxAttachment,
  composeMailboxMessage,
  initMailboxComposeWithAttachment,
} from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";
import type { MailboxDocType } from "@/lib/mailbox-types";

export const runtime = "nodejs";

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function parseComposeInput(body: Record<string, unknown>) {
  return {
    subject: String(body.subject || "").trim(),
    body: String(body.body || "").trim(),
    docType: (body.doc_type ? String(body.doc_type) : undefined) as MailboxDocType | undefined,
    expedienteRef: body.expediente_ref ? String(body.expediente_ref).trim() : null,
    to: parseStringArray(body.to),
    cc: parseStringArray(body.cc),
    bcc: parseStringArray(body.bcc),
    followerIds: parseStringArray(body.followers),
  };
}

export async function POST(req: Request) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Content-Type debe ser application/json" },
        { status: 415 }
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const phase = body.phase ? String(body.phase) : null;

    if (phase === "init") {
      const input = parseComposeInput(body);
      const fileName = String(body.file_name || "");
      const fileSize = Number(body.file_size || 0);
      const result = await initMailboxComposeWithAttachment(user!.id, input, {
        fileName,
        sizeBytes: fileSize,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (phase === "commit") {
      const threadId = String(body.thread_id || "");
      const messageId = String(body.message_id || "");
      const attachment = body.attachment as Record<string, unknown> | undefined;
      if (!threadId || !messageId || !attachment) {
        return NextResponse.json({ error: "Faltan datos del adjunto" }, { status: 400 });
      }

      const result = await commitMailboxAttachment(user!.id, threadId, messageId, {
        attachmentId: String(attachment.attachment_id || ""),
        storage_path: String(attachment.storage_path || ""),
        file_name: String(attachment.file_name || ""),
        content_type: String(attachment.content_type || ""),
        size_bytes: Number(attachment.size_bytes || 0),
        version: Number(attachment.version || 1),
      });

      return NextResponse.json({ ok: true, ...result });
    }

    const input = parseComposeInput(body);
    const result = await composeMailboxMessage(user!.id, input, null);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mailboxError(e, 400);
  }
}
