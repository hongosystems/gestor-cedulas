export function isMailboxLinkedNotification(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const threadId = (metadata as Record<string, unknown>).mailbox_thread_id;
  return typeof threadId === "string" && threadId.length > 0;
}

export function isTransferLinkedNotification(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const transferId = (metadata as Record<string, unknown>).transfer_id;
  return typeof transferId === "string" && transferId.length > 0;
}
