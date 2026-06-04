import { supabase } from "@/lib/supabase";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sin sesión");
  return { Authorization: `Bearer ${token}` };
}

export async function fetchMailboxInbox(folder: string, q = "") {
  const h = await authHeaders();
  const params = new URLSearchParams({ folder });
  if (q.trim()) params.set("q", q.trim());
  const res = await fetch(`/api/mailbox/inbox?${params}`, { headers: h });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Error al cargar bandeja");
  return json.items as import("@/lib/mailbox-types").MailboxInboxItem[];
}

export async function fetchMailboxThread(id: string, source?: string) {
  const h = await authHeaders();
  const q = source ? `?source=${source}` : "";
  const res = await fetch(`/api/mailbox/threads/${id}${q}`, { headers: h });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Error al cargar hilo");
  return json as import("@/lib/mailbox-types").MailboxThreadDetail;
}

export async function fetchUnreadMailboxCount() {
  const h = await authHeaders();
  const res = await fetch("/api/mailbox/unread-count", { headers: h });
  const json = await res.json();
  if (!res.ok) return 0;
  return json.count as number;
}
