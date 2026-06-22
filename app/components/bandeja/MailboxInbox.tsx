"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePageSearchOptional } from "@/app/components/shell/PageSearchContext";
import {
  fetchSearchHitsForQuery,
  filterInboxItems,
  loadMailboxInboxForFolder,
} from "@/lib/bandeja-inbox-search";
import type { MailboxInboxItem } from "@/lib/mailbox-types";
import type { Profile } from "@/lib/bandeja-utils";
import { markMailboxThreadRead } from "@/lib/mailbox-client";
import MailboxThreadView from "@/app/components/bandeja/MailboxThreadView";
import { docTypeLabel, fmtRelativeTime } from "@/lib/bandeja-utils";

type MailboxInboxProps = {
  folder: "inbox" | "sent" | "archived" | "unread" | "all" | "action";
  searchQuery?: string;
  onListChanged?: () => void;
};

export default function MailboxInbox({
  folder,
  searchQuery = "",
  onListChanged,
}: MailboxInboxProps) {
  const pageSearch = usePageSearchOptional();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [allItems, setAllItems] = useState<MailboxInboxItem[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [searchHits, setSearchHits] = useState<Awaited<ReturnType<typeof fetchSearchHitsForQuery>>>([]);
  const [selected, setSelected] = useState<MailboxInboxItem | null>(null);

  /** Siempre el valor del topbar (aunque el bridge esté desregistrado). */
  const liveSearch = (pageSearch?.value ?? searchQuery).trim();

  const loadFolder = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const { items, profiles: profs } = await loadMailboxInboxForFolder(folder);
      setAllItems(items);
      setProfiles(profs);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
      setAllItems([]);
    } finally {
      setLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    loadFolder();
  }, [loadFolder]);

  useEffect(() => {
    if (!liveSearch) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      fetchSearchHitsForQuery(liveSearch)
        .then((hits) => {
          if (!cancelled) setSearchHits(hits);
        })
        .catch(() => {
          if (!cancelled) setSearchHits([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [liveSearch]);

  const items = useMemo(
    () => filterInboxItems(allItems, liveSearch, profiles, searchHits),
    [allItems, liveSearch, profiles, searchHits]
  );

  const displayItems = useMemo(() => {
    if (folder !== "unread" || !selected) return items;
    const selectedKey = `${selected.source}-${selected.id}`;
    if (items.some((i) => `${i.source}-${i.id}` === selectedKey)) return items;
    return [selected, ...items];
  }, [items, selected, folder]);

  const markItemReadIfNeeded = useCallback(
    async (item: MailboxInboxItem | null) => {
      if (!item?.unread) return;
      try {
        await markMailboxThreadRead(item.threadId);
        setAllItems((prev) =>
          prev.map((i) =>
            i.threadId === item.threadId ? { ...i, unread: false } : i
          )
        );
        onListChanged?.();
      } catch {
        /* mantener estado local si falla */
      }
    },
    [onListChanged]
  );

  const selectItem = useCallback(
    async (next: MailboxInboxItem) => {
      setSelected(next);
      if (next.unread) {
        void markItemReadIfNeeded(next);
      }
    },
    [markItemReadIfNeeded]
  );

  const closeItem = useCallback(async () => {
    if (selected?.unread) {
      await markItemReadIfNeeded(selected);
    }
    setSelected(null);
  }, [selected, markItemReadIfNeeded]);

  useEffect(() => {
    if (!selected) return;
    const stillVisible = displayItems.some(
      (i) => i.id === selected.id && i.source === selected.source
    );
    if (!stillVisible) setSelected(null);
  }, [displayItems, selected]);

  if (loading) {
    return (
      <>
        <div className="bandeja-mail-list">
          <p className="bandeja-loading">Cargando mensajes…</p>
        </div>
        <div className="bandeja-mail-thread bandeja-mail-thread--empty" />
      </>
    );
  }

  return (
    <>
      <div
        className={`bandeja-mail-list${selected ? " is-hidden-mobile" : ""}`}
        role="list"
        aria-label="Conversaciones"
      >
        {msg ? (
          <div className="bandeja-mail-list-banner error" role="alert">
            {msg}
          </div>
        ) : null}
        {items.length === 0 ? (
          <div className="bandeja-empty">
            {liveSearch ? (
              <>
                <p style={{ margin: "0 0 8px" }}>
                  Sin resultados para “{liveSearch}”.
                </p>
                {allItems.length > 0 ? (
                  <>
                    <p style={{ margin: "0 0 12px", color: "rgba(234,243,255,.65)" }}>
                      {folder === "unread"
                        ? `Hay ${allItems.length} mensaje${allItems.length === 1 ? "" : "s"} no leído${allItems.length === 1 ? "" : "s"} oculto${allItems.length === 1 ? "" : "s"} por la búsqueda.`
                        : `Hay ${allItems.length} mensaje${allItems.length === 1 ? "" : "s"} en esta carpeta que no coincide${allItems.length === 1 ? "" : "n"} con la búsqueda.`}
                    </p>
                    <button
                      type="button"
                      className="bandeja-empty-action"
                      onClick={() => pageSearch?.onChange("")}
                    >
                      Limpiar búsqueda
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              "No hay mensajes en esta carpeta."
            )}
          </div>
        ) : (
          displayItems.map((t) => (
            <button
              key={`${t.source}-${t.id}`}
              type="button"
              role="listitem"
              className={`bandeja-row${selected?.id === t.id && selected?.source === t.source ? " is-selected" : ""}${t.unread ? " is-unread" : ""}`}
              onClick={() => void selectItem(t)}
            >
              <span className="bandeja-row-type">{docTypeLabel(t.docType)}</span>
              <div className="bandeja-row-main">
                <div className="bandeja-row-top">
                  <span className="bandeja-row-subject">{t.subject}</span>
                  <span className="bandeja-row-date">{fmtRelativeTime(t.lastMessageAt)}</span>
                </div>
                <div className="bandeja-row-meta">{t.peerLabel}</div>
                {t.preview ? <div className="bandeja-row-preview">{t.preview}</div> : null}
              </div>
              <span
                className={`bandeja-row-status${t.hasAttachment ? " has-attach" : ""}`}
                aria-hidden
              >
                {t.unread ? <span className="bandeja-row-dot" title="No leído" /> : null}
                {t.hasAttachment ? <span className="bandeja-row-attach">📎</span> : null}
              </span>
            </button>
          ))
        )}
      </div>

      <div
        className={`bandeja-mail-thread${selected ? " is-open" : " bandeja-mail-thread--empty"}`}
      >
        {selected ? (
          <MailboxThreadView
            item={selected}
            onClose={() => void closeItem()}
            onUpdated={() => {
              loadFolder();
              onListChanged?.();
            }}
          />
        ) : (
          <div className="bandeja-thread-placeholder">
            <p>Seleccioná una conversación para leerla</p>
          </div>
        )}
      </div>
    </>
  );
}
