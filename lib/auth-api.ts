import { User } from "@supabase/supabase-js";

export async function getUserFromRequest(req: Request): Promise<User | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  try {
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) return null;

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const { data: { user }, error } = await supabaseClient.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

export async function getMediacionesRole(userId: string, supabaseAdmin: ReturnType<typeof import("@/lib/supabase-server").supabaseService>) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("is_admin_mediaciones, is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    isAdminMediaciones: data?.is_admin_mediaciones === true,
    isSuperadmin: data?.is_superadmin === true,
  };
}
