import { NextResponse } from "next/server";
import { searchMailbox } from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;
    const q = new URL(req.url).searchParams.get("q") || "";
    const results = await searchMailbox(user!.id, q);
    return NextResponse.json({ results });
  } catch (e) {
    return mailboxError(e);
  }
}
