"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMailboxInbox } from "@/lib/mailbox-client";
import type { MailboxInboxItem } from "@/lib/mailbox-types";
import MailboxThreadView from "@/app/components/bandeja/MailboxThreadView";
import { docTypeLabel, fmtRelativeTime } from "@/lib/bandeja-utils";

type MailboxInboxProps = {
  folder: "inbox" | "sent" | "archived" | "unread" | "all" | "action";
  searchQuery?: string;
};

export default function MailboxInbox({ folder, searchQuery = "" }: MailboxInboxProps) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState<MailboxInboxItem[]>([]);
  const [selected, setSelected] = useState<MailboxInboxItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const data = await fetchMailboxInbox(folder, searchQuery);
      setItems(data);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [folder, searchQuery]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="helper">Cargando bandeja…</p>;

  return (
    <>
      {msg && <div className="error" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className={`bandeja-split${selected ? " is-detail-open" : " is-list-only"}`}>
        <div className="bandeja-list">
          {items.length === 0 ? (
            <div className="bandeja-empty">
              {searchQuery.trim()
                ? `Sin resultados para “${searchQuery.trim()}”.`
                : "No hay mensajes en esta carpeta."}
            </div>
          ) : (
            items.map((t) => (
              <button
                key={`${t.source}-${t.id}`}
                type="button"
                className={`bandeja-row${selected?.id === t.id && selected?.source === t.source ? " is-selected" : ""}${t.unread ? " is-unread" : ""}`}
                onClick={() => setSelected(t)}
              >
                <span className="bandeja-row-type">{docTypeLabel(t.docType)}</span>
                <div className="bandeja-row-main">
                  <div className="bandeja-row-subject">{t.subject}</div>
                  <div className="bandeja-row-meta">{t.peerLabel}</div>
                  {t.preview && <div className="bandeja-row-preview">{t.preview}</div>}
                </div>
                {t.hasAttachment ? (
                  <span className="bandeja-row-attach" title="Adjunto">
                    📎
                  </span>
                ) : (
                  <span className="bandeja-row-attach bandeja-row-attach--muted">💬</span>
                )}
                <div className="bandeja-row-aside">
                  <span className="bandeja-row-date">{fmtRelativeTime(t.lastMessageAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>
        {selected && (
          <MailboxThreadView
            item={selected}
            onClose={() => setSelected(null)}
            onUpdated={load}
          />
        )}
      </div>
    </>
  );
}
