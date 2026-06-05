import { fetchMailboxInbox, fetchMailboxSearch, type MailboxSearchHit } from "@/lib/mailbox-client";
import type { MailboxInboxItem } from "@/lib/mailbox-types";
import {
  dedupeInboxItems,
  filterActionItems,
  type MailboxFolder,
} from "@/lib/bandeja-mail-folders";
import { normalizeSearchText, textMatchesQuery } from "@/lib/bandeja-search";
import { displayName, docTypeLabel, type Profile } from "@/lib/bandeja-utils";
import { fetchBandejaUsers } from "@/lib/bandeja-users";

export type { MailboxSearchHit };

function threadIdFromHit(hit: MailboxSearchHit): string | null {
  if (hit.threadId) return hit.threadId;
  if (hit.type === "thread") return hit.id;
  return null;
}

/** Texto indexable de un ítem de bandeja (mailbox + legacy). */
export function getInboxItemSearchText(
  item: MailboxInboxItem,
  profiles: Record<string, Profile>,
  searchHits: MailboxSearchHit[] = []
): string {
  const peer = item.peerUserId ? profiles[item.peerUserId] : undefined;
  const hitExtras = searchHits
    .filter((h) => threadIdFromHit(h) === item.threadId)
    .flatMap((h) => [h.subject, h.preview, h.fileName]);

  return normalizeSearchText(
    item.subject,
    item.preview,
    item.peerLabel,
    peer?.full_name,
    peer?.email,
    item.expedienteRef,
    item.expedienteCaratula,
    item.expedienteJuzgado,
    docTypeLabel(item.docType),
    ...(item.attachmentNames || []),
    ...hitExtras
  );
}

function profileIdsMatchingQuery(
  profiles: Record<string, Profile>,
  needle: string
): Set<string> {
  const ids = new Set<string>();
  for (const [id, u] of Object.entries(profiles)) {
    if (textMatchesQuery(normalizeSearchText(displayName(u), u.email), needle)) {
      ids.add(id);
    }
  }
  return ids;
}

export function inboxItemMatchesQuery(
  item: MailboxInboxItem,
  q: string,
  profiles: Record<string, Profile>,
  searchHits: MailboxSearchHit[] = []
): boolean {
  const needle = q.trim();
  if (!needle) return true;
  if (textMatchesQuery(getInboxItemSearchText(item, profiles, searchHits), needle)) {
    return true;
  }
  if (item.peerUserId && profileIdsMatchingQuery(profiles, needle).has(item.peerUserId)) {
    return true;
  }
  return false;
}

export function filterInboxItems(
  items: MailboxInboxItem[],
  q: string,
  profiles: Record<string, Profile>,
  searchHits: MailboxSearchHit[] = []
): MailboxInboxItem[] {
  if (!q.trim()) return items;
  return items.filter((item) => inboxItemMatchesQuery(item, q, profiles, searchHits));
}

export function profilesFromUsers(users: Profile[]): Record<string, Profile> {
  const map: Record<string, Profile> = {};
  for (const u of users) map[u.id] = u;
  return map;
}

async function loadProfiles() {
  const users = await fetchBandejaUsers().catch(() => [] as Profile[]);
  return profilesFromUsers(users);
}

/**
 * Carga el dataset de la pestaña activa (sin `q` en API; filtro de búsqueda en cliente).
 *
 * - inbox: destinatario (recibidos)
 * - sent: emisor (enviados)
 * - all: inbox + sent deduplicado
 * - unread: no leídos
 * - archived: archivados
 * - action: no leídos o document_status pendiente
 */
export async function loadMailboxInboxForFolder(folder: MailboxFolder) {
  const profiles = await loadProfiles();

  if (folder === "all") {
    const [inbox, sent] = await Promise.all([
      fetchMailboxInbox("inbox", ""),
      fetchMailboxInbox("sent", ""),
    ]);
    return { items: dedupeInboxItems([...inbox, ...sent]), profiles };
  }

  if (folder === "action") {
    const inbox = await fetchMailboxInbox("inbox", "");
    return { items: filterActionItems(inbox), profiles };
  }

  const items = await fetchMailboxInbox(folder, "");
  return { items, profiles };
}

export type MailboxFolderCounts = {
  received: number;
  sent: number;
  all: number;
  unread: number;
  archived: number;
  action: number;
};

export async function fetchMailboxFolderCounts(): Promise<MailboxFolderCounts> {
  const [inbox, sent, archived, unread] = await Promise.all([
    fetchMailboxInbox("inbox", ""),
    fetchMailboxInbox("sent", ""),
    fetchMailboxInbox("archived", ""),
    fetchMailboxInbox("unread", ""),
  ]);
  const all = dedupeInboxItems([...inbox, ...sent]);
  return {
    received: inbox.length,
    sent: sent.length,
    all: all.length,
    unread: unread.length,
    archived: archived.length,
    action: filterActionItems(inbox).length,
  };
}

export async function fetchSearchHitsForQuery(q: string): Promise<MailboxSearchHit[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  return fetchMailboxSearch(trimmed);
}
