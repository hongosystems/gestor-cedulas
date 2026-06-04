import { NextResponse } from "next/server";
import { findMailboxThreadId, getMailboxThread, markThreadRead } from "@/lib/mailbox-service";
import { supabaseService } from "@/lib/supabase-server";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;
    const { id } = await ctx.params;
    const source = new URL(req.url).searchParams.get("source") || undefined;

    const detail = await getMailboxThread(user!.id, id, source || undefined);
    if (!detail) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    const mailboxId = await findMailboxThreadId(supabaseService(), id);
    if (mailboxId) {
      await markThreadRead(user!.id, mailboxId);
    }

    return NextResponse.json(detail);
  } catch (e) {
    return mailboxError(e);
  }
}
