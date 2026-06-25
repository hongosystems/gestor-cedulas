/**
 * Estado de lectura de la bandeja — fuente de verdad: mailbox_recipients.read_at.
 * Las filas en notifications para envíos/transferencias son espejo; se sincronizan aquí.
 */
import { findMailboxThreadId } from "@/lib/mailbox-thread-resolve";
import type { supabaseService } from "@/lib/supabase-server";

type Svc = ReturnType<typeof supabaseService>;

export type MarkThreadReadResult = {
  threadId: string;
  recipientRowsUpdated: number;
  notificationRowsUpdated: number;
};

export type MailboxReconcileResult = {
  imported: number;
  backfilled: number;
};

/** read_at del destinatario al importar un file_transfer legacy (respeta notifications previas). */
export async function legacyTransferRecipientReadAt(
  svc: Svc,
  recipientUserId: string,
  transferId: string
): Promise<string | null> {
  const { data: rows, error } = await svc
    .from("notifications")
    .select("is_read, created_at")
    .eq("user_id", recipientUserId)
    .filter("metadata->>transfer_id", "eq", transferId);

  if (error) throw new Error(error.message);
  if (!rows?.length) return null;

  const allRead = rows.every((row) => row.is_read === true);
  if (!allRead) return null;

  const latest = rows.reduce((max, row) => {
    const ts = new Date(row.created_at as string).getTime();
    return ts > max ? ts : max;
  }, 0);
  return new Date(latest).toISOString();
}

/** Marca leídas las notifications vinculadas a un hilo mailbox (transfer + mailbox_thread_id). */
export async function syncNotificationsReadForMailboxThread(
  svc: Svc,
  userId: string,
  mailboxThreadId: string,
  legacyTransferId?: string | null
): Promise<number> {
  let updated = 0;

  const { data: byThread, error: threadErr } = await svc
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false)
    .filter("metadata->>mailbox_thread_id", "eq", mailboxThreadId)
    .select("id");
  if (threadErr) throw new Error(threadErr.message);
  updated += byThread?.length ?? 0;

  const transferIds = new Set<string>();
  if (legacyTransferId) transferIds.add(legacyTransferId);

  for (const transferId of transferIds) {
    const { data: byTransfer, error: transferErr } = await svc
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false)
      .filter("metadata->>transfer_id", "eq", transferId)
      .select("id");
    if (transferErr) throw new Error(transferErr.message);
    updated += byTransfer?.length ?? 0;
  }

  return updated;
}

/**
 * Marca un hilo como leído para el usuario.
 * Actualiza mailbox_recipients y sincroniza notifications legacy vinculadas.
 */
export async function markThreadRead(
  svc: Svc,
  userId: string,
  threadOrLegacyId: string
): Promise<MarkThreadReadResult> {
  const mailboxId = (await findMailboxThreadId(svc, threadOrLegacyId)) ?? threadOrLegacyId;

  const { data: thread, error: threadErr } = await svc
    .from("mailbox_threads")
    .select("id, legacy_transfer_id")
    .eq("id", mailboxId)
    .maybeSingle();
  if (threadErr) throw new Error(threadErr.message);
  if (!thread?.id) throw new Error("Hilo no encontrado");

  const readAt = new Date().toISOString();
  const { data: updatedRecipients, error: recipientErr } = await svc
    .from("mailbox_recipients")
    .update({ read_at: readAt })
    .eq("thread_id", mailboxId)
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (recipientErr) throw new Error(recipientErr.message);

  const notificationRowsUpdated = await syncNotificationsReadForMailboxThread(
    svc,
    userId,
    mailboxId,
    thread.legacy_transfer_id as string | null
  );

  return {
    threadId: mailboxId,
    recipientRowsUpdated: updatedRecipients?.length ?? 0,
    notificationRowsUpdated,
  };
}

/**
 * Corrige read_at en hilos ya importados desde legacy según notifications.is_read.
 * Idempotente; seguro ejecutar en cada reconciliación de usuario.
 */
export async function backfillMailboxReadStateForUser(svc: Svc, userId: string): Promise<number> {
  const { data: readNotifications, error: nErr } = await svc
    .from("notifications")
    .select("metadata, created_at")
    .eq("user_id", userId)
    .eq("is_read", true)
    .not("metadata", "is", null);
  if (nErr) throw new Error(nErr.message);

  const readAtByTransfer = new Map<string, string>();
  for (const row of readNotifications || []) {
    const meta = row.metadata as Record<string, unknown> | null;
    const transferId = meta?.transfer_id;
    if (typeof transferId !== "string" || !transferId) continue;
    const ts = new Date(row.created_at as string).toISOString();
    const prev = readAtByTransfer.get(transferId);
    if (!prev || ts > prev) readAtByTransfer.set(transferId, ts);
  }

  if (readAtByTransfer.size === 0) return 0;

  const transferIds = [...readAtByTransfer.keys()];
  const { data: threads, error: tErr } = await svc
    .from("mailbox_threads")
    .select("id, legacy_transfer_id")
    .in("legacy_transfer_id", transferIds);
  if (tErr) throw new Error(tErr.message);

  let backfilled = 0;
  for (const thread of threads || []) {
    const legacyId = thread.legacy_transfer_id as string;
    const readAt = readAtByTransfer.get(legacyId);
    if (!readAt) continue;

    const { data: updated, error: uErr } = await svc
      .from("mailbox_recipients")
      .update({ read_at: readAt })
      .eq("thread_id", thread.id)
      .eq("user_id", userId)
      .is("read_at", null)
      .select("id");
    if (uErr) throw new Error(uErr.message);
    backfilled += updated?.length ?? 0;
  }

  return backfilled;
}

/** Marca notifications como leídas cuando el mailbox ya no tiene pendientes para ese hilo. */
export async function syncNotificationsFromMailboxReadState(
  svc: Svc,
  userId: string
): Promise<number> {
  const { data: unreadRecipients, error: rErr } = await svc
    .from("mailbox_recipients")
    .select("thread_id")
    .eq("user_id", userId)
    .is("read_at", null)
    .is("archived_at", null)
    .eq("folder", "inbox");
  if (rErr) throw new Error(rErr.message);

  const unreadThreadIds = new Set(
    (unreadRecipients || []).map((row) => row.thread_id as string).filter(Boolean)
  );

  const { data: staleNotifications, error: nErr } = await svc
    .from("notifications")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("is_read", false);
  if (nErr) throw new Error(nErr.message);

  const idsToMark: string[] = [];
  for (const notif of staleNotifications || []) {
    const meta = (notif.metadata || {}) as Record<string, unknown>;
    const mailboxThreadId =
      typeof meta.mailbox_thread_id === "string" ? meta.mailbox_thread_id : null;
    const transferId = typeof meta.transfer_id === "string" ? meta.transfer_id : null;

    if (mailboxThreadId && !unreadThreadIds.has(mailboxThreadId)) {
      idsToMark.push(notif.id as string);
      continue;
    }

    if (transferId) {
      const { data: thread } = await svc
        .from("mailbox_threads")
        .select("id")
        .eq("legacy_transfer_id", transferId)
        .maybeSingle();
      if (thread?.id && !unreadThreadIds.has(thread.id)) {
        idsToMark.push(notif.id as string);
      }
    }
  }

  if (idsToMark.length === 0) return 0;

  const { data: updated, error: uErr } = await svc
    .from("notifications")
    .update({ is_read: true })
    .in("id", idsToMark)
    .select("id");
  if (uErr) throw new Error(uErr.message);
  return updated?.length ?? 0;
}

/** Reconciliación completa del estado de lectura para un usuario workflow. */
export async function reconcileMailboxReadStateForUser(
  svc: Svc,
  userId: string
): Promise<{ backfilled: number; notificationsSynced: number }> {
  const backfilled = await backfillMailboxReadStateForUser(svc, userId);
  const notificationsSynced = await syncNotificationsFromMailboxReadState(svc, userId);
  return { backfilled, notificationsSynced };
}
