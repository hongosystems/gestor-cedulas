import { NextResponse } from "next/server";
import { archiveRecipient } from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;
    const { id } = await ctx.params;
    const { archive } = await req.json();
    await archiveRecipient(user!.id, id, archive !== false);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mailboxError(e);
  }
}
