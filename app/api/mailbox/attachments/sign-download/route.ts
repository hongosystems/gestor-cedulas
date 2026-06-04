import { NextResponse } from "next/server";
import { signMailboxAttachmentDownload } from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;
    const { attachmentId } = await req.json();
    if (!attachmentId) {
      return NextResponse.json({ error: "Falta attachmentId" }, { status: 400 });
    }
    const result = await signMailboxAttachmentDownload(user!.id, attachmentId);
    return NextResponse.json(result);
  } catch (e) {
    return mailboxError(e);
  }
}
