import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth-api";
import { countUserUnreadBadge } from "@/lib/unread-notifications";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const counts = await countUserUnreadBadge(user.id);
    return NextResponse.json(counts);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
