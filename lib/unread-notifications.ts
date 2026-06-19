import { canWorkflowCedulas } from "@/lib/bandeja-utils";
import { countUnreadMailbox } from "@/lib/mailbox-service";
import { isMailboxLinkedNotification, isTransferLinkedNotification } from "@/lib/notification-utils";
import { supabaseService } from "@/lib/supabase-server";

export type UnreadBadgeCounts = {
  total: number;
  mailbox: number;
  app: number;
  workflow: boolean;
};

export async function userHasMailboxWorkflow(userId: string): Promise<boolean> {
  const svc = supabaseService();
  const { data } = await svc
    .from("user_roles")
    .select("is_superadmin, is_abogado, is_admin_expedientes, is_admin_cedulas")
    .eq("user_id", userId)
    .maybeSingle();

  return canWorkflowCedulas({
    isSuperadmin: data?.is_superadmin === true,
    isAbogado: data?.is_abogado === true,
    isAdminExpedientes: data?.is_admin_expedientes === true,
    isAdminCedulas: data?.is_admin_cedulas === true,
  });
}

export async function countUnreadAppNotifications(userId: string): Promise<number> {
  const svc = supabaseService();
  const { data, error } = await svc.rpc("count_app_notifications_unread", {
    p_user_id: userId,
  });
  if (error) {
    const { data: rows, error: fallbackError } = await svc
      .from("notifications")
      .select("metadata")
      .eq("user_id", userId)
      .eq("is_read", false);
    if (fallbackError) throw fallbackError;
    return (rows || []).filter(
      (row) =>
        !isMailboxLinkedNotification(row.metadata) &&
        !isTransferLinkedNotification(row.metadata)
    ).length;
  }
  return typeof data === "number" ? data : 0;
}

export async function countAllUnreadNotifications(userId: string): Promise<number> {
  const svc = supabaseService();
  const { count, error } = await svc
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) throw error;
  return count ?? 0;
}

/** Contador unificado para la campanita: mailbox + alertas de sistema, sin duplicar. */
export async function countUserUnreadBadge(userId: string): Promise<UnreadBadgeCounts> {
  const workflow = await userHasMailboxWorkflow(userId);
  if (!workflow) {
    const app = await countAllUnreadNotifications(userId);
    return { total: app, mailbox: 0, app, workflow: false };
  }

  const [mailbox, app] = await Promise.all([
    countUnreadMailbox(userId),
    countUnreadAppNotifications(userId),
  ]);
  return { total: mailbox + app, mailbox, app, workflow: true };
}

/** Marca como leídas las notifications legacy vinculadas a un hilo de bandeja. */
export async function markMailboxNotificationsReadForThread(
  userId: string,
  threadId: string
): Promise<void> {
  const svc = supabaseService();
  const { error } = await svc
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false)
    .filter("metadata->>mailbox_thread_id", "eq", threadId);
  if (error) throw error;
}
