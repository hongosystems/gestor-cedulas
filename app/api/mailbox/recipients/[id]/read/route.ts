import { NextResponse } from "next/server";
import { markRecipientRead } from "@/lib/mailbox-service";
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
    const { read } = await req.json();
    await markRecipientRead(user!.id, id, read !== false);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mailboxError(e);
  }
}
