import { NextResponse } from "next/server";
import {
  commitMailboxAttachments,
  composeMailboxMessage,
  initMailboxComposeWithAttachments,
} from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";
import {
  parseMailboxFileMetas,
  parseMailboxPendingAttachments,
} from "@/lib/mailbox-compose-api-parsers";
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
      const files = parseMailboxFileMetas(body);
      if (files.length === 0) {
        return NextResponse.json({ error: "Faltan datos del adjunto" }, { status: 400 });
      }
      const result = await initMailboxComposeWithAttachments(user!.id, input, files);
      return NextResponse.json({ ok: true, ...result });
    }

    if (phase === "commit") {
      const threadId = String(body.thread_id || "");
      const messageId = String(body.message_id || "");
      const attachments = parseMailboxPendingAttachments(body);
      if (!threadId || !messageId || attachments.length === 0) {
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

    const input = parseComposeInput(body);
    const result = await composeMailboxMessage(user!.id, input, null);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mailboxError(e, 400);
  }
}
