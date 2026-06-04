import { NextResponse } from "next/server";
import { getMailboxMetrics } from "@/lib/mailbox-service";
import { getUserFromRequest } from "@/lib/auth-api";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const svc = supabaseService();
    const { data: role } = await svc
      .from("user_roles")
      .select("is_superadmin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!role?.is_superadmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const metrics = await getMailboxMetrics();
    return NextResponse.json(metrics);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
