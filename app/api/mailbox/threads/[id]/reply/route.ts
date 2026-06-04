import { NextResponse } from "next/server";
import { composeMailboxMessage, resolveMailboxThreadId } from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;
    const { id } = await ctx.params;
    const threadId = await resolveMailboxThreadId(user!.id, id);

    const form = await req.formData();
    const body = String(form.get("body") || "").trim();
    const file = form.get("file");
    const replyTo = String(form.get("reply_to_message_id") || "") || undefined;

    const parseIds = (key: string) => {
      const raw = form.get(key);
      if (!raw) return [];
      try {
        return JSON.parse(String(raw)) as string[];
      } catch {
        return [];
      }
    };

    const extraTo = parseIds("to");
    const result = await composeMailboxMessage(
      user!.id,
      {
        body,
        threadId,
        replyToMessageId: replyTo,
        to: extraTo,
        cc: parseIds("cc"),
        bcc: parseIds("bcc"),
      },
      file instanceof File ? file : null
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mailboxError(e, 400);
  }
}
