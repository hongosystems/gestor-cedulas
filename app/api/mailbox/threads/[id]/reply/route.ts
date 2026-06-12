import { NextResponse } from "next/server";
import {
  commitMailboxAttachment,
  composeMailboxMessage,
  initMailboxComposeWithAttachment,
  resolveMailboxThreadId,
} from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [];
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;
    const { id } = await ctx.params;
    const threadId = await resolveMailboxThreadId(user!.id, id);

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Content-Type debe ser application/json" },
        { status: 415 }
      );
    }

    const body = (await req.json()) as Record<string, unknown>;
    const phase = body.phase ? String(body.phase) : null;
    const replyTo = body.reply_to_message_id
      ? String(body.reply_to_message_id)
      : undefined;

    const baseInput = {
      body: String(body.body || "").trim(),
      threadId,
      replyToMessageId: replyTo,
      to: parseStringArray(body.to),
      cc: parseStringArray(body.cc),
      bcc: parseStringArray(body.bcc),
    };

    if (phase === "init") {
      const fileName = String(body.file_name || "");
      const fileSize = Number(body.file_size || 0);
      const result = await initMailboxComposeWithAttachment(user!.id, baseInput, {
        fileName,
        sizeBytes: fileSize,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (phase === "commit") {
      const messageId = String(body.message_id || "");
      const attachment = body.attachment as Record<string, unknown> | undefined;
      if (!messageId || !attachment) {
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

    const result = await composeMailboxMessage(user!.id, baseInput, null);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mailboxError(e, 400);
  }
}
