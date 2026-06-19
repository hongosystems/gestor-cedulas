import { NextResponse } from "next/server";
import { findMailboxThreadId, markThreadRead } from "@/lib/mailbox-service";
import { supabaseService } from "@/lib/supabase-server";
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

    const mailboxId = await findMailboxThreadId(supabaseService(), id);
    if (mailboxId) {
      await markThreadRead(user!.id, mailboxId);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return mailboxError(e);
  }
}
