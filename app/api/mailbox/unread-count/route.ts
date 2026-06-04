import { NextResponse } from "next/server";
import { countUnreadMailbox } from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;
    const count = await countUnreadMailbox(user!.id);
    return NextResponse.json({ count });
  } catch (e) {
    return mailboxError(e);
  }
}
