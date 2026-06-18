export function isMailboxLinkedNotification(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const threadId = (metadata as Record<string, unknown>).mailbox_thread_id;
  return typeof threadId === "string" && threadId.length > 0;
}
