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

/** Importa transferencias legacy al mailbox (usuarios con workflow). */
export async function syncLegacyMailboxTransfers(): Promise<number> {
  const headers = await authHeaders();
  const res = await fetch("/api/mailbox/sync-legacy", { method: "POST", headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Error al sincronizar bandeja");
  return typeof json.imported === "number" ? json.imported : 0;
}
