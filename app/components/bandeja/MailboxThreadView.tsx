"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchMailboxThread } from "@/lib/mailbox-client";
import { MAX_MAILBOX_ATTACHMENT_BYTES, sendMailboxMessage } from "@/lib/mailbox-send-client";
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

const REPLY_MAX_CHARS = 10000;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MailboxThreadView({ item, onClose, onUpdated }: MailboxThreadViewProps) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchMailboxThread>> | null>(null);
  const [reply, setReply] = useState("");
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [replyDragOver, setReplyDragOver] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState<string[]>([]);
  const [forwardBody, setForwardBody] = useState("");
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState<Profile[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement>(null);

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
  const participants =
    detail?.participants?.map((p) => p.name).join(", ") || item.peerLabel;

  function pickReplyFile(f: File | null) {
    if (!f) return;
    setReplyFile(f);
  }

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
    const body = reply.trim();
    const hasFile = replyFile && replyFile.size > 0;
    if (!body && !hasFile) return setMsg("Escribí una respuesta o adjuntá un archivo");
    if (hasFile && replyFile!.size > MAX_MAILBOX_ATTACHMENT_BYTES) {
      return setMsg(
        `El archivo supera el límite de ${MAX_MAILBOX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`
      );
    }
    setSending(true);
    setMsg("");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const replyThreadId = detail?.thread.id || item.threadId;
      const result = await sendMailboxMessage(
        `/api/mailbox/threads/${replyThreadId}/reply`,
        token,
        {
          body,
          reply_to_message_id: lastMsg?.id,
        },
        replyFile
      );
      if (!result.ok) throw new Error(result.error);
      setReply("");
      setReplyFile(null);
      if (replyFileInputRef.current) replyFileInputRef.current.value = "";
      onUpdated();
      const threadKey = result.threadId || item.threadId;
      const d = await fetchMailboxThread(threadKey, item.source);
      setDetail(d);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setSending(false);
    }
  }

  function scrollToReply() {
    document.getElementById("bandeja-reply-block")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    document.getElementById("bandeja-reply-input")?.focus();
  }

  return (
    <article className="bandeja-thread">
      <header className="bandeja-thread__header">
        <button type="button" className="bandeja-thread__back" onClick={onClose}>
          ← Volver
        </button>
        <h1 className="bandeja-thread__subject">{item.subject}</h1>
        <dl className="bandeja-thread__meta">
          <div>
            <dt>Participantes</dt>
            <dd>{participants}</dd>
          </div>
          {detail?.thread.expedienteRef ? (
            <div>
              <dt>Expediente</dt>
              <dd>{detail.thread.expedienteRef}</dd>
            </div>
          ) : null}
          <div>
            <dt>Última actividad</dt>
            <dd>
              {fmtDateShort(item.lastMessageAt)} · {fmtRelativeTime(item.lastMessageAt)}
            </dd>
          </div>
        </dl>
      </header>

      {!loading && (
        <div className="bandeja-thread__toolbar" role="toolbar" aria-label="Acciones del hilo">
          {hasAttachment && lastMsg?.attachments[0] ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => downloadAttachment(lastMsg.attachments[0].id)}
            >
              Descargar
            </button>
          ) : null}
          <button
            type="button"
            className={`btn btn--ghost${forwardOpen ? " is-active" : ""}`}
            onClick={() => {
              setForwardOpen((v) => !v);
              setMsg("");
            }}
            disabled={sending || !lastMsg}
          >
            {forwardOpen ? "Cancelar reenvío" : "Reenviar"}
          </button>
          {!forwardOpen ? (
            <button type="button" className="btn btn--ghost" onClick={scrollToReply} disabled={sending}>
              Responder
            </button>
          ) : null}
        </div>
      )}

      <div className="bandeja-thread__scroll">
        {loading ? (
          <p className="bandeja-loading bandeja-thread__loading">Cargando conversación…</p>
        ) : (
          <div className="bandeja-thread__messages">
            {detail?.messages.map((m) => {
              const bodyText = (m.body || "").trim();
              const showBody = bodyText && bodyText !== "(sin texto)";
              return (
                <div key={m.id} className="bandeja-thread__message">
                  <div className="bandeja-thread__message-head">
                    <span className="bandeja-thread__message-author">{m.senderName}</span>
                    <time className="bandeja-thread__message-time">{fmtRelativeTime(m.createdAt)}</time>
                  </div>
                  {showBody ? <div className="bandeja-thread__message-body">{m.body}</div> : null}
                  {m.attachments.length > 0 ? (
                    <div className="bandeja-thread__message-files">
                      {m.attachments.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="bandeja-thread__file"
                          onClick={() => downloadAttachment(a.id)}
                          title={a.fileName}
                        >
                          <span className="bandeja-thread__file-icon" aria-hidden>
                            📎
                          </span>
                          <span className="bandeja-thread__file-name">{a.fileName}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {!loading && (
          <footer id="bandeja-reply-block" className="bandeja-thread__composer">
            {msg ? (
              <div
                className={`bandeja-thread__feedback${msg.includes("correctamente") ? " is-success" : " is-error"}`}
                role="status"
              >
                {msg}
              </div>
            ) : null}

            {forwardOpen ? (
              <div className="bandeja-thread__forward">
                <p className="bandeja-thread__composer-label">
                  Reenviar a <span className="bandeja-thread__hint">(nuevo hilo)</span>
                </p>
                <RecipientMultiSelect
                  users={users}
                  value={forwardTo}
                  onChange={setForwardTo}
                  disabled={sending}
                  variant="field"
                  usePortal
                />
                <textarea
                  className="bandeja-thread__textarea bandeja-thread__textarea--sm"
                  value={forwardBody}
                  onChange={(e) => setForwardBody(e.target.value)}
                  placeholder="Comentario al reenviar (opcional)"
                  rows={2}
                />
                <div className="bandeja-thread__composer-actions">
                  <button type="button" className="btn" disabled={sending} onClick={() => setForwardOpen(false)}>
                    Cancelar
                  </button>
                  <button type="button" className="btn primary" disabled={sending} onClick={sendForward}>
                    {sending ? "Enviando…" : "Enviar reenvío"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bandeja-thread__reply">
                <label className="bandeja-thread__composer-label" htmlFor="bandeja-reply-input">
                  Responder
                </label>
                <MentionTextarea
                  id="bandeja-reply-input"
                  className="bandeja-thread__textarea"
                  value={reply}
                  onChange={(v) => setReply(v.slice(0, REPLY_MAX_CHARS))}
                  users={users}
                  placeholder="Escribí una respuesta. Usá @ para mencionar usuarios."
                  disabled={sending}
                  rows={4}
                />
                <div className="bandeja-thread__reply-meta">
                  <span className="bandeja-thread__char-count">
                    {reply.length} / {REPLY_MAX_CHARS}
                  </span>
                </div>

                <div className="bandeja-thread__reply-attach">
                  <input
                    ref={replyFileInputRef}
                    type="file"
                    className="bandeja-thread__file-input"
                    accept=".docx,.pdf,.png,.jpg,.jpeg,.zip"
                    disabled={sending}
                    onChange={(e) => pickReplyFile(e.target.files?.[0] ?? null)}
                  />
                  <div
                    className={`bandeja-thread__dropzone${replyDragOver ? " is-dragover" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setReplyDragOver(true);
                    }}
                    onDragLeave={() => setReplyDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setReplyDragOver(false);
                      pickReplyFile(e.dataTransfer.files?.[0] ?? null);
                    }}
                    onClick={() => replyFileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        replyFileInputRef.current?.click();
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label="Adjuntar archivo a la respuesta"
                  >
                    <span className="bandeja-thread__dropzone-label">Adjuntar archivo</span>
                    <span className="bandeja-thread__dropzone-hint">
                      Arrastrá aquí o hacé click · .pdf .docx .jpg .png .zip
                    </span>
                  </div>
                  {replyFile ? (
                    <div className="bandeja-thread__file-preview">
                      <button
                        type="button"
                        className="bandeja-thread__file"
                        onClick={() => replyFileInputRef.current?.click()}
                      >
                        <span className="bandeja-thread__file-icon" aria-hidden>
                          📎
                        </span>
                        <span className="bandeja-thread__file-name">{replyFile.name}</span>
                        <span className="bandeja-thread__file-size">{formatFileSize(replyFile.size)}</span>
                      </button>
                      <button
                        type="button"
                        className="bandeja-thread__file-remove"
                        disabled={sending}
                        onClick={() => {
                          setReplyFile(null);
                          if (replyFileInputRef.current) replyFileInputRef.current.value = "";
                        }}
                      >
                        Quitar
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="bandeja-thread__composer-actions">
                  <button type="button" className="btn primary" disabled={sending} onClick={sendReply}>
                    {sending ? "Enviando…" : "Enviar respuesta"}
                  </button>
                </div>
              </div>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}
