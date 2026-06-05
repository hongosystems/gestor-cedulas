"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchMailboxThread } from "@/lib/mailbox-client";
import type { MailboxInboxItem } from "@/lib/mailbox-types";
import { fmtDateShort, fmtRelativeTime } from "@/lib/bandeja-utils";
import RecipientMultiSelect from "@/app/components/bandeja/RecipientMultiSelect";
import MentionTextarea from "@/app/components/bandeja/MentionTextarea";
import { fetchBandejaUsers } from "@/lib/bandeja-users";

type MailboxThreadViewProps = {
  item: MailboxInboxItem;
  onClose: () => void;
  onUpdated: () => void;
};

type Profile = { id: string; full_name: string | null; email: string | null };

export default function MailboxThreadView({ item, onClose, onUpdated }: MailboxThreadViewProps) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchMailboxThread>> | null>(null);
  const [reply, setReply] = useState("");
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState<string[]>([]);
  const [forwardBody, setForwardBody] = useState("");
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState<Profile[]>([]);

  const loadThread = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const d = await fetchMailboxThread(item.threadId, item.source);
      setDetail(d);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [item.threadId, item.source]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    fetchBandejaUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const lastMsg = detail?.messages[detail.messages.length - 1];
  const hasAttachment = detail?.messages.some((m) => m.attachments.length > 0) ?? false;
  const isLegacyView = detail?.thread.source === "legacy";

  async function downloadAttachment(attachmentId: string) {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return;
    setMsg("");
    if (isLegacyView) {
      const res = await fetch("/api/transfers/sign-download", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transferId: item.threadId }),
      });
      const json = await res.json();
      if (res.ok && json.url) window.open(json.url, "_blank");
      else setMsg(json.error || "No se pudo descargar");
      return;
    }
    const res = await fetch("/api/mailbox/attachments/sign-download", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ attachmentId }),
    });
    const json = await res.json();
    if (res.ok && json.url) window.open(json.url, "_blank");
    else setMsg(json.error || "No se pudo descargar");
  }

  async function sendForward() {
    if (forwardTo.length === 0) return setMsg("Elegí destinatarios para reenviar");
    if (!lastMsg) return;
    setSending(true);
    setMsg("");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/mailbox/messages/${lastMsg.id}/forward`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: forwardTo,
          body: forwardBody.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo reenviar");
      setForwardOpen(false);
      setForwardTo([]);
      setForwardBody("");
      setMsg("Reenviado correctamente. El hilo original se mantiene en esta conversación.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setSending(false);
    }
  }

  async function sendReply() {
    if (!reply.trim()) return setMsg("Escribí una respuesta");
    setSending(true);
    setMsg("");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const fd = new FormData();
      fd.append("body", reply);
      if (lastMsg) fd.append("reply_to_message_id", lastMsg.id);
      const replyThreadId = detail?.thread.id || item.threadId;
      const res = await fetch(`/api/mailbox/threads/${replyThreadId}/reply`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo enviar");
      setReply("");
      onUpdated();
      const threadKey = (json.threadId as string) || item.threadId;
      const d = await fetchMailboxThread(threadKey, item.source);
      setDetail(d);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bandeja-detail bandeja-detail--thread">
      <div className="bandeja-detail-header">
        <button type="button" className="btn bandeja-mobile-back" onClick={onClose}>
          ← Volver
        </button>
        <h3 className="bandeja-detail-title">{item.subject}</h3>
        <div className="bandeja-detail-meta">
          <div>
            <strong>De / Para:</strong> {item.peerLabel}
          </div>
          {detail?.thread.expedienteRef && (
            <div>
              <strong>Expediente:</strong> {detail.thread.expedienteRef}
            </div>
          )}
          <div>
            <strong>Última actividad:</strong> {fmtDateShort(item.lastMessageAt)} (
            {fmtRelativeTime(item.lastMessageAt)})
          </div>
          {detail?.participants && detail.participants.length > 0 && (
            <div>
              <strong>Participantes:</strong>{" "}
              {detail.participants.map((p) => p.name).join(", ")}
            </div>
          )}
        </div>
      </div>

      {!loading && (
        <div className="bandeja-detail-actions">
          {hasAttachment && lastMsg?.attachments[0] && (
            <button
              type="button"
              className="btn primary"
              onClick={() => downloadAttachment(lastMsg.attachments[0].id)}
            >
              Descargar adjunto
            </button>
          )}
          <button
            type="button"
            className={`btn${forwardOpen ? " is-active" : ""}`}
            onClick={() => setForwardOpen((v) => !v)}
            disabled={sending || !lastMsg}
          >
            {forwardOpen ? "Cancelar reenvío" : "Reenviar"}
          </button>
        </div>
      )}

      {loading ? (
        <p className="helper bandeja-detail-loading">Cargando hilo…</p>
      ) : (
        <>
          <div className="bandeja-thread-messages">
            {detail?.messages.map((m) => {
              const bodyText = (m.body || "").trim();
              const showBody = bodyText && bodyText !== "(sin texto)";
              return (
                <div key={m.id} className="bandeja-thread-bubble">
                  <div className="bandeja-thread-bubble-head">
                    <strong>{m.senderName}</strong>
                    <span>{fmtRelativeTime(m.createdAt)}</span>
                  </div>
                  {showBody && <div className="bandeja-thread-bubble-body">{m.body}</div>}
                  {m.attachments.length > 0 && (
                    <div className="bandeja-thread-attachments">
                      {m.attachments.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="bandeja-thread-attach-btn"
                          onClick={() => downloadAttachment(a.id)}
                        >
                          <span className="bandeja-thread-attach-icon" aria-hidden>
                            📎
                          </span>
                          <span className="bandeja-thread-attach-name">{a.fileName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bandeja-thread-footer">
            {forwardOpen ? (
              <div className="bandeja-forward-panel">
                <label className="label">Reenviar a (nuevo hilo; esta conversación se conserva)</label>
                <RecipientMultiSelect
                  users={users}
                  value={forwardTo}
                  onChange={setForwardTo}
                  disabled={sending}
                  variant="field"
                />
                <textarea
                  className="bandeja-message bandeja-message--compact"
                  value={forwardBody}
                  onChange={(e) => setForwardBody(e.target.value)}
                  placeholder="Comentario al reenviar (opcional)"
                  rows={2}
                />
                <div className="bandeja-thread-footer-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={sending}
                    onClick={() => setForwardOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={sending}
                    onClick={sendForward}
                  >
                    {sending ? "Enviando…" : "Enviar reenvío"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bandeja-reply-box">
                <label className="label">Responder en este hilo</label>
                <MentionTextarea
                  className="bandeja-message bandeja-message--compact"
                  value={reply}
                  onChange={setReply}
                  users={users}
                  placeholder="Escribí tu respuesta… @ para mencionar"
                  disabled={sending}
                  rows={3}
                />
                <div className="bandeja-thread-footer-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={sending}
                    onClick={sendReply}
                  >
                    {sending ? "Enviando…" : "Enviar respuesta"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {msg && (
        <div
          className={msg.includes("correctamente") ? "success" : "error"}
          style={{ margin: "0 16px 12px" }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}
