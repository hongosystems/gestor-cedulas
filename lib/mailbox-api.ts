import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth-api";

export async function requireMailboxUser(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user, error: null };
}

export function mailboxError(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Error";
  const code = message.includes("Forbidden") ? 403 : status;
  return NextResponse.json({ error: message }, { status: code });
}
