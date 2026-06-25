import { NextResponse } from "next/server";
import { markThreadRead } from "@/lib/mailbox-read-state";
import { findMailboxThreadId } from "@/lib/mailbox-thread-resolve";
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
    const svc = supabaseService();

    const mailboxId = await findMailboxThreadId(svc, id);
    if (!mailboxId) {
      return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });
    }

    const result = await markThreadRead(svc, user!.id, mailboxId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mailboxError(e);
  }
}
