"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { displayName, type DocType, type Profile } from "@/lib/bandeja-utils";
import ComposeDocTypeSelect from "@/app/components/bandeja/ComposeDocTypeSelect";
import ExpedienteAutocomplete, { type ExpedienteOption } from "@/app/components/bandeja/ExpedienteAutocomplete";
import RecipientMultiSelect from "@/app/components/bandeja/RecipientMultiSelect";
import { fetchBandejaUsers } from "@/lib/bandeja-users";
import MentionTextarea from "@/app/components/bandeja/MentionTextarea";
import { assertValidMailboxFile } from "@/lib/mailbox-attachments";
import {
  MAX_MAILBOX_ATTACHMENT_BYTES,
  MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE,
  sendMailboxMessage,
} from "@/lib/mailbox-send-client";

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
  const [files, setFiles] = useState<File[]>([]);
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

  const addFiles = useCallback((incoming: FileList | File[] | null) => {
    if (!incoming || incoming.length === 0) return;
    const toAdd = Array.from(incoming);
    setFiles((prev) => {
      const next = [...prev];
      for (const f of toAdd) {
        if (next.length >= MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE) {
          setMsg(`Podés adjuntar hasta ${MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE} archivos.`);
          return prev;
        }
        try {
          assertValidMailboxFile(f.name, f.size);
          next.push(f);
        } catch (e) {
          setMsg(e instanceof Error ? e.message : "Archivo inválido.");
          return prev;
        }
      }
      setMsg("");
      return next;
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  async function onSend() {
    setMsg("");

    if (allRecipientIds.length === 0) return setMsg("Elegí al menos un destinatario.");

    const messageText = message.trim();
    if (!messageText && files.length === 0) {
      return setMsg("Escribí un mensaje o adjuntá un archivo.");
    }

    setSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        window.location.href = "/login";
        return;
      }

      const result = await sendMailboxMessage(
        "/api/mailbox/threads",
        token,
        {
          subject: title.trim(),
          doc_type: docType,
          body: messageText,
          to,
          cc,
          bcc,
          expediente_ref: expediente?.ref ?? null,
        },
        files.length > 0 ? files : null
      );

      if (!result.ok) {
        setMsg(result.error);
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
      setFiles([]);
      setTo([]);
      setCc([]);
      setBcc([]);
      onSuccess?.();
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <p className="bandeja-loading">Cargando formulario…</p>;
  }

  return (
    <div className={`bandeja-compose-panel${embedded ? " is-embedded" : ""}`}>
      {embedded && (
        <header className="bandeja-compose-intro">
          <h2>Redactar</h2>
          <p className="bandeja-compose-intro-hint">
            Mensaje interno a uno o más destinatarios en un solo hilo.
          </p>
        </header>
      )}

      {msg ? (
        <div
          className={`bandeja-compose-feedback${msg.includes("correctamente") ? " is-success" : " is-error"}`}
          role="status"
        >
          {msg}
        </div>
      ) : null}

      <div className="bandeja-composer">
        <div className="bandeja-composer-row">
          <span className="bandeja-composer-label">De</span>
          <span className="bandeja-composer-value">{senderName}</span>
        </div>

        <div className="bandeja-composer-row bandeja-composer-row--field">
          <span className="bandeja-composer-label">Para</span>
          <div className="bandeja-composer-field">
            <RecipientMultiSelect
              users={users}
              value={to}
              onChange={setTo}
              disabled={sending}
              variant="field"
            />
          </div>
        </div>

        {(!showCc || !showBcc) && (
          <div className="bandeja-composer-row bandeja-composer-row--cc-links">
            <span className="bandeja-composer-label" aria-hidden="true" />
            <div className="bandeja-compose-cc-actions" aria-label="Agregar copias">
              {!showCc && (
                <button
                  type="button"
                  className="bandeja-compose-add-link"
                  onClick={() => setShowCc(true)}
                  disabled={sending}
                >
                  + Agregar Cc
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  className="bandeja-compose-add-link"
                  onClick={() => setShowBcc(true)}
                  disabled={sending}
                >
                  + Agregar Cco
                </button>
              )}
            </div>
          </div>
        )}

        {showCc && (
          <div className="bandeja-composer-row bandeja-composer-row--field">
            <span className="bandeja-composer-label">
              Cc
              <button
                type="button"
                className="bandeja-compose-add-link bandeja-compose-add-link--dismiss"
                onClick={() => {
                  setShowCc(false);
                  setCc([]);
                }}
                disabled={sending}
                aria-label="Quitar Cc"
              >
                Quitar
              </button>
            </span>
            <div className="bandeja-composer-field">
              <RecipientMultiSelect
                users={users}
                value={cc}
                onChange={setCc}
                disabled={sending}
                variant="field"
              />
            </div>
          </div>
        )}

        {showBcc && (
          <div className="bandeja-composer-row bandeja-composer-row--field">
            <span className="bandeja-composer-label">
              Cco
              <button
                type="button"
                className="bandeja-compose-add-link bandeja-compose-add-link--dismiss"
                onClick={() => {
                  setShowBcc(false);
                  setBcc([]);
                }}
                disabled={sending}
                aria-label="Quitar Cco"
              >
                Quitar
              </button>
            </span>
            <div className="bandeja-composer-field">
              <RecipientMultiSelect
                users={users}
                value={bcc}
                onChange={setBcc}
                disabled={sending}
                variant="field"
              />
            </div>
          </div>
        )}

        <div className="bandeja-composer-row bandeja-composer-row--field">
          <span className="bandeja-composer-label">Tipo</span>
          <div className="bandeja-composer-field">
            <ComposeDocTypeSelect value={docType} onChange={setDocType} disabled={sending} />
          </div>
        </div>

        <div className="bandeja-composer-row">
          <span className="bandeja-composer-label">Asunto</span>
          <input
            className="bandeja-composer-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ej: Oficio Banco X"
            disabled={sending}
          />
        </div>

        <div className="bandeja-composer-row bandeja-composer-row--field">
          <span className="bandeja-composer-label">Expediente</span>
          <div className="bandeja-composer-field">
            <ExpedienteAutocomplete
              value={expediente}
              onChange={setExpediente}
              disabled={sending}
              variant="field"
            />
          </div>
        </div>

        <div className="bandeja-composer-row bandeja-composer-row--field bandeja-composer-row--message">
          <span className="bandeja-composer-label">Mensaje</span>
          <div className="bandeja-composer-field">
            <MentionTextarea
              className="bandeja-message"
              value={message}
              onChange={setMessage}
              users={users}
              placeholder="Escribí tu mensaje… Usá @ para mencionar usuarios"
              disabled={sending}
            />
          </div>
        </div>

        <div className="bandeja-composer-row bandeja-composer-row--field bandeja-composer-row--attachments">
          <span className="bandeja-composer-label">Adjuntos</span>
          <div className="bandeja-composer-field">
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
                addFiles(e.dataTransfer.files);
              }}
            >
              <input
                type="file"
                multiple
                accept=".docx,.pdf,.png,.jpg,.jpeg,.zip"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
                disabled={sending || files.length >= MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE}
              />
              <div className="bandeja-dropzone-title">
                Arrastrá archivos o hacé click para adjuntar
              </div>
              <div className="bandeja-dropzone-hint">
                .docx · .pdf · .png · .jpg · .jpeg · .zip · máx.{" "}
                {MAX_MAILBOX_ATTACHMENT_BYTES / (1024 * 1024)} MB c/u · hasta{" "}
                {MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE} archivos
              </div>
            </div>

            {files.length > 0 && (
              <div className="bandeja-file-list">
                {files.map((f, index) => (
                  <div key={`${f.name}-${index}`} className="bandeja-file-chip">
                    <span>
                      📎 {f.name} · {formatFileSize(f.size)}
                    </span>
                    <button
                      type="button"
                      className="bandeja-cc-toggle"
                      onClick={() => removeFile(index)}
                      disabled={sending}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
  );
}
