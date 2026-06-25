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

export type MailboxReconcileResponse = {
  imported: number;
  backfilled: number;
  notificationsSynced: number;
};

const RECONCILE_SESSION_KEY = "mailbox_reconcile_v1";

/**
 * Reconciliación de bandeja (import legacy + alinear lecturas).
 * Se ejecuta una vez por sesión de navegador para evitar ruido en cada focus.
 */
export async function reconcileMailboxState(
  opts?: { force?: boolean }
): Promise<MailboxReconcileResponse> {
  if (!opts?.force && typeof sessionStorage !== "undefined") {
    if (sessionStorage.getItem(RECONCILE_SESSION_KEY) === "done") {
      return { imported: 0, backfilled: 0, notificationsSynced: 0 };
    }
  }

  const headers = await authHeaders();
  const res = await fetch("/api/mailbox/sync-legacy", { method: "POST", headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Error al reconciliar bandeja");

  const result: MailboxReconcileResponse = {
    imported: typeof json.imported === "number" ? json.imported : 0,
    backfilled: typeof json.backfilled === "number" ? json.backfilled : 0,
    notificationsSynced:
      typeof json.notificationsSynced === "number" ? json.notificationsSynced : 0,
  };

  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(RECONCILE_SESSION_KEY, "done");
  }
  return result;
}

/** @deprecated Usar reconcileMailboxState */
export async function syncLegacyMailboxTransfers(): Promise<number> {
  const result = await reconcileMailboxState({ force: true });
  return result.imported;
}
