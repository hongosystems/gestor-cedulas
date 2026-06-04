import { NextResponse } from "next/server";
import { listMailboxInbox } from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;

    const url = new URL(req.url);
    const folder = (url.searchParams.get("folder") || "inbox") as
      | "inbox"
      | "sent"
      | "archived"
      | "unread"
      | "all"
      | "action";
    const q = url.searchParams.get("q") || "";

    const items = await listMailboxInbox(user!.id, { folder, q });
    return NextResponse.json({ items });
  } catch (e) {
    return mailboxError(e);
  }
}
