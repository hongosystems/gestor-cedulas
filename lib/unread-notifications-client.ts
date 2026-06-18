import { supabase } from "@/lib/supabase";
import type { UnreadBadgeCounts } from "@/lib/unread-notifications";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sin sesión");
  return { Authorization: `Bearer ${token}` };
}

export async function fetchUnreadBadgeCounts(): Promise<UnreadBadgeCounts> {
  const headers = await authHeaders();
  const res = await fetch("/api/notifications/unread-count", { headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Error al cargar contador");
  return json as UnreadBadgeCounts;
}
