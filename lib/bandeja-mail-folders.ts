import type { BandejaTab } from "@/lib/bandeja-utils";
import type { MailboxInboxItem } from "@/lib/mailbox-types";

export type MailboxFolder =
  | "inbox"
  | "sent"
  | "archived"
  | "unread"
  | "all"
  | "action";

const MAILBOX_TABS: BandejaTab[] = [
  "recibidos",
  "enviados",
  "todas",
  "no-leidas",
];

export function isMailboxTab(tab: BandejaTab): boolean {
  return MAILBOX_TABS.includes(tab);
}

export function bandejaTabToFolder(tab: BandejaTab): MailboxFolder | null {
  switch (tab) {
    case "recibidos":
      return "inbox";
    case "enviados":
      return "sent";
    case "archivados":
      return "archived";
    case "todas":
      return "all";
    case "no-leidas":
      return "unread";
    default:
      return null;
  }
}

export function inboxItemKey(item: MailboxInboxItem): string {
  return `${item.source}-${item.threadId}`;
}

/** Un hilo por source+threadId; conserva el de última actividad más reciente. */
export function dedupeInboxItems(items: MailboxInboxItem[]): MailboxInboxItem[] {
  const byKey = new Map<string, MailboxInboxItem>();
  for (const item of items) {
    const key = inboxItemKey(item);
    const prev = byKey.get(key);
    if (
      !prev ||
      new Date(item.lastMessageAt).getTime() > new Date(prev.lastMessageAt).getTime()
    ) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  );
}

const ACTION_STATUSES = new Set(["open", "pending", "in_review"]);

/** Pendientes de documento o no leídos para el usuario actual. */
export function filterActionItems(items: MailboxInboxItem[]): MailboxInboxItem[] {
  return dedupeInboxItems(
    items.filter(
      (i) =>
        i.unread ||
        (i.documentStatus != null && ACTION_STATUSES.has(i.documentStatus))
    )
  );
}
