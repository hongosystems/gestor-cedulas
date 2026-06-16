import { NextResponse } from "next/server";
import {
  commitMailboxAttachments,
  composeMailboxMessage,
  initMailboxComposeWithAttachments,
  resolveMailboxThreadId,
} from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";
import {
  parseMailboxFileMetas,
  parseMailboxPendingAttachments,
} from "@/lib/mailbox-compose-api-parsers";

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
      const files = parseMailboxFileMetas(body);
      if (files.length === 0) {
        return NextResponse.json({ error: "Faltan datos del adjunto" }, { status: 400 });
      }
      const result = await initMailboxComposeWithAttachments(user!.id, baseInput, files);
      return NextResponse.json({ ok: true, ...result });
    }

    if (phase === "commit") {
      const messageId = String(body.message_id || "");
      const attachments = parseMailboxPendingAttachments(body);
      if (!messageId || attachments.length === 0) {
        return NextResponse.json({ error: "Faltan datos del adjunto" }, { status: 400 });
      }

      const result = await commitMailboxAttachments(
        user!.id,
        threadId,
        messageId,
        attachments.map((a) => ({
          attachmentId: a.attachmentId,
          storage_path: a.storage_path,
          file_name: a.file_name,
          content_type: a.content_type,
          size_bytes: a.size_bytes,
          version: a.version,
        }))
      );

      return NextResponse.json({ ok: true, ...result });
    }

    const result = await composeMailboxMessage(user!.id, baseInput, null);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mailboxError(e, 400);
  }
}
