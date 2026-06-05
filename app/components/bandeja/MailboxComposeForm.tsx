"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { displayName, docTypeLabel, type DocType, type Profile } from "@/lib/bandeja-utils";
import ExpedienteAutocomplete, { type ExpedienteOption } from "@/app/components/bandeja/ExpedienteAutocomplete";
import RecipientMultiSelect, {
  formatRecipientsSummary,
} from "@/app/components/bandeja/RecipientMultiSelect";
import { fetchBandejaUsers } from "@/lib/bandeja-users";
import MentionTextarea from "@/app/components/bandeja/MentionTextarea";

type MailboxComposeFormProps = {
  embedded?: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MailboxComposeForm({
  embedded = false,
  onSuccess,
  onCancel,
}: MailboxComposeFormProps) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [senderName, setSenderName] = useState("Vos");
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [docType, setDocType] = useState<DocType>("CEDULA");
  const [title, setTitle] = useState("");
  const [expediente, setExpediente] = useState<ExpedienteOption | null>(null);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }

      const uid = sess.session.user.id;
      const [profiles, { data: me }] = await Promise.all([
        fetchBandejaUsers(),
        supabase.from("profiles").select("full_name, email").eq("id", uid).maybeSingle(),
      ]);

      setUsers(profiles);
      setSenderName(displayName(me as Profile));
      setLoading(false);
    })();
  }, []);

  const allRecipientIds = useMemo(
    () => [...new Set([...to, ...cc, ...bcc])],
    [to, cc, bcc]
  );

  const pickFile = useCallback((f: File | null) => {
    if (!f) return;
    setFile(f);
  }, []);

  async function onSend() {
    setMsg("");

    if (allRecipientIds.length === 0) return setMsg("Elegí al menos un destinatario.");

    const messageText = message.trim();
    if (!messageText && !file) {
      return setMsg("Escribí un mensaje o adjuntá un archivo.");
    }

    if (file) {
      const allowedExts = [".docx", ".pdf", ".png", ".jpg", ".jpeg", ".zip"];
      const name = file.name.toLowerCase();
      const ok = allowedExts.some((ext) => name.endsWith(ext));
      if (!ok) {
        return setMsg("El archivo debe ser .docx, .pdf, .png, .jpg, .jpeg o .zip.");
      }
    }

    setSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        window.location.href = "/login";
        return;
      }

      const fd = new FormData();
      fd.append("subject", title.trim());
      fd.append("doc_type", docType);
      fd.append("body", messageText);
      fd.append("to", JSON.stringify(to));
      fd.append("cc", JSON.stringify(cc));
      fd.append("bcc", JSON.stringify(bcc));
      if (expediente?.ref) fd.append("expediente_ref", expediente.ref);
      if (file) fd.append("file", file);

      const res = await fetch("/api/mailbox/threads", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg((json?.error as string) || "No se pudo enviar.");
        return;
      }

      setMsg(
        allRecipientIds.length === 1
          ? "Enviado correctamente."
          : `Enviado correctamente a ${allRecipientIds.length} destinatarios (un solo hilo).`
      );
      setTitle("");
      setMessage("");
      setExpediente(null);
      setFile(null);
      setTo([]);
      setCc([]);
      setBcc([]);
      onSuccess?.();
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <p className="helper">Cargando formulario…</p>;
  }

  return (
    <div className={`bandeja-compose-panel${embedded ? " is-embedded" : ""}`}>
      {embedded && (
        <div className="bandeja-compose-intro">
          <h2>Redactar</h2>
          <p className="helper">
            Casilla interna: un hilo, un archivo compartido, estado de lectura por usuario.
          </p>
        </div>
      )}

      {msg && (
        <div className={msg.includes("correctamente") ? "success" : "error"} style={{ marginBottom: 12 }}>
          {msg}
        </div>
      )}

      <div className="bandeja-composer-layout">
        <div className="bandeja-composer-main">
          <div className="bandeja-composer">
            <div className="bandeja-composer-row">
              <span className="bandeja-composer-label">De</span>
              <span className="bandeja-composer-value">{senderName}</span>
            </div>

            <div className="bandeja-composer-recipients">
              <div className="bandeja-composer-row is-stack">
                <span className="bandeja-composer-label">Para</span>
                <div className="bandeja-composer-field-wrap">
                  {(!showCc || !showBcc) && (
                    <div className="bandeja-composer-cc-actions" aria-label="Agregar copias">
                      {!showCc && (
                        <button
                          type="button"
                          className="bandeja-cc-toggle"
                          onClick={() => setShowCc(true)}
                          disabled={sending}
                        >
                          Cc
                        </button>
                      )}
                      {!showBcc && (
                        <button
                          type="button"
                          className="bandeja-cc-toggle"
                          onClick={() => setShowBcc(true)}
                          disabled={sending}
                        >
                          Cco
                        </button>
                      )}
                    </div>
                  )}
                  <RecipientMultiSelect users={users} value={to} onChange={setTo} disabled={sending} />
                </div>
              </div>

              {showCc && (
                <div className="bandeja-composer-row is-stack">
                  <span className="bandeja-composer-label">Cc</span>
                  <div className="bandeja-composer-field-wrap">
                    <div className="bandeja-composer-cc-actions">
                      <button
                        type="button"
                        className="bandeja-cc-toggle bandeja-cc-toggle--dismiss"
                        onClick={() => {
                          setShowCc(false);
                          setCc([]);
                        }}
                        disabled={sending}
                        aria-label="Quitar Cc"
                        title="Quitar Cc"
                      >
                        ×
                      </button>
                    </div>
                    <RecipientMultiSelect users={users} value={cc} onChange={setCc} disabled={sending} />
                  </div>
                </div>
              )}

              {showBcc && (
                <div className="bandeja-composer-row is-stack">
                  <span className="bandeja-composer-label">Cco</span>
                  <div className="bandeja-composer-field-wrap">
                    <div className="bandeja-composer-cc-actions">
                      <button
                        type="button"
                        className="bandeja-cc-toggle bandeja-cc-toggle--dismiss"
                        onClick={() => {
                          setShowBcc(false);
                          setBcc([]);
                        }}
                        disabled={sending}
                        aria-label="Quitar Cco"
                        title="Quitar Cco"
                      >
                        ×
                      </button>
                    </div>
                    <RecipientMultiSelect users={users} value={bcc} onChange={setBcc} disabled={sending} />
                  </div>
                </div>
              )}
            </div>

            <div className="bandeja-composer-row">
              <span className="bandeja-composer-label">Tipo</span>
              <select
                className="input"
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocType)}
                disabled={sending}
              >
                <option value="CEDULA">Cédula</option>
                <option value="OFICIO">Oficio</option>
                <option value="OTROS_ESCRITOS">Documento / Otro</option>
              </select>
            </div>

            <div className="bandeja-composer-row">
              <span className="bandeja-composer-label">Asunto</span>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej: Oficio Banco X"
                disabled={sending}
              />
            </div>

            <div className="bandeja-composer-row is-stack">
              <span className="bandeja-composer-label" style={{ paddingTop: 4 }}>
                Expediente
              </span>
              <ExpedienteAutocomplete value={expediente} onChange={setExpediente} disabled={sending} />
            </div>

            <div className="bandeja-composer-row is-stack bandeja-composer-row--message">
              <span className="bandeja-composer-label" style={{ paddingTop: 4 }}>
                Mensaje
              </span>
              <MentionTextarea
                className="bandeja-message"
                value={message}
                onChange={setMessage}
                users={users}
                placeholder="Mensaje… Escribí @ para mencionar a alguien"
                disabled={sending}
              />
            </div>

            <div className="bandeja-composer-row is-stack">
              <span className="bandeja-composer-label" style={{ paddingTop: 4 }}>
                Adjuntos
              </span>
              <div className="bandeja-attachments-block">
                <div
                  className={`bandeja-dropzone${dragOver ? " is-dragover" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    pickFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                >
                  <input
                    type="file"
                    accept=".docx,.pdf,.png,.jpg,.jpeg,.zip"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                    disabled={sending}
                  />
                  <div className="bandeja-dropzone-title">
                    Opcional — arrastrá un archivo o hacé click para adjuntar
                  </div>
                  <div className="bandeja-dropzone-hint">.docx · .pdf · .png · .jpg · .jpeg · .zip</div>
                </div>

                {file && (
                  <div className="bandeja-file-chip">
                    <span>
                      📎 {file.name} · {formatFileSize(file.size)}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "4px 10px", fontSize: 11 }}
                      onClick={() => setFile(null)}
                      disabled={sending}
                    >
                      Quitar
                    </button>
                  </div>
                )}
                <p className="bandeja-attachments-hint">
                  Podés enviar solo mensaje, solo archivo, o ambos. Un adjunto compartido para todos.
                </p>
              </div>
            </div>

            <div className="bandeja-composer-actions">
              <button type="button" className="btn primary" disabled={sending} onClick={onSend}>
                {sending ? "Enviando…" : "Enviar"}
              </button>
              {embedded && onCancel && (
                <button type="button" className="btn" onClick={onCancel} disabled={sending}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="bandeja-composer-aside">
          <div className="bandeja-summary-card">
            <h3>Resumen del envío</h3>
            <dl className="bandeja-summary-list">
              <div>
                <dt>Para</dt>
                <dd>{formatRecipientsSummary(to, users)}</dd>
              </div>
              {cc.length > 0 && (
                <div>
                  <dt>CC</dt>
                  <dd>{formatRecipientsSummary(cc, users)}</dd>
                </div>
              )}
              {bcc.length > 0 && (
                <div>
                  <dt>CCO</dt>
                  <dd>{formatRecipientsSummary(bcc, users)}</dd>
                </div>
              )}
              <div>
                <dt>Tipo</dt>
                <dd>{docTypeLabel(docType)}</dd>
              </div>
              <div>
                <dt>Asunto</dt>
                <dd>{title.trim() || "—"}</dd>
              </div>
              <div>
                <dt>Adjunto</dt>
                <dd>{file ? file.name : "Sin adjunto"}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
