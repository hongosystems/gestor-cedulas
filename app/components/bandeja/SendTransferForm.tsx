"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { displayName, docTypeLabel, type DocType, type Profile } from "@/lib/bandeja-utils";
import ExpedienteAutocomplete, { type ExpedienteOption } from "@/app/components/bandeja/ExpedienteAutocomplete";
import RecipientMultiSelect, {
  formatRecipientsSummary,
} from "@/app/components/bandeja/RecipientMultiSelect";

type SendTransferFormProps = {
  embedded?: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SendTransferForm({
  embedded = false,
  onSuccess,
  onCancel,
}: SendTransferFormProps) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [senderName, setSenderName] = useState("Vos");
  const [currentUserId, setCurrentUserId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [docType, setDocType] = useState<DocType>("CEDULA");
  const [title, setTitle] = useState("");
  const [expediente, setExpediente] = useState<ExpedienteOption | null>(null);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }

      const uid = sess.session.user.id;
      const [{ data: profiles, error }, { data: me }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true }),
        supabase.from("profiles").select("full_name, email").eq("id", uid).maybeSingle(),
      ]);

      if (error) {
        setMsg(error.message);
        setLoading(false);
        return;
      }

      setUsers((profiles ?? []) as Profile[]);
      setCurrentUserId(uid);
      setSenderName(displayName(me as Profile));
      setLoading(false);
    })();
  }, []);

  const recipientProfiles = useMemo(
    () =>
      recipients
        .map((id) => users.find((u) => u.id === id))
        .filter(Boolean) as Profile[],
    [users, recipients]
  );

  const pickFile = useCallback((f: File | null) => {
    if (!f) return;
    setFile(f);
  }, []);

  async function onSend() {
    setMsg("");

    if (recipients.length === 0) return setMsg("Elegí al menos un destinatario.");
    if (!file) return setMsg("Adjuntá un archivo.");

    const allowedExts = [".docx", ".pdf", ".png", ".jpg", ".jpeg", ".zip"];
    const name = file.name.toLowerCase();
    const ok = allowedExts.some((ext) => name.endsWith(ext));

    if (!ok) {
      return setMsg("El archivo debe ser .docx, .pdf, .png, .jpg, .jpeg o .zip.");
    }

    setSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        window.location.href = "/login";
        return;
      }

      type SendAttempt = { userId: string; ok: boolean; error?: string };
      const attempts: SendAttempt[] = [];

      for (const recipientId of recipients) {
        const fd = new FormData();
        fd.append("recipient_user_id", recipientId);
        fd.append("doc_type", docType);
        fd.append("title", title.trim());
        if (expediente?.ref) {
          fd.append("expediente_ref", expediente.ref);
        }
        fd.append("file", file);

        try {
          const res = await fetch("/api/transfers/send", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            attempts.push({
              userId: recipientId,
              ok: false,
              error: (json?.error as string) || "No se pudo enviar.",
            });
          } else {
            attempts.push({ userId: recipientId, ok: true });
          }
        } catch {
          attempts.push({
            userId: recipientId,
            ok: false,
            error: "Error de red al enviar.",
          });
        }
      }

      const okCount = attempts.filter((a) => a.ok).length;
      const failed = attempts.filter((a) => !a.ok);

      if (okCount === 0) {
        const first = failed[0];
        setMsg(
          failed.length === 1
            ? first?.error || "No se pudo enviar."
            : `No se pudo enviar a ningún destinatario. ${first?.error || ""}`
        );
        if (who) setRecipients(failed.map((f) => f.userId));
        return;
      }

      if (failed.length > 0) {
        const failedNames = failed
          .map((f) => {
            const p = users.find((u) => u.id === f.userId);
            return p ? displayName(p) : "Usuario";
          })
          .join(", ");
        setMsg(
          `Enviado a ${okCount} de ${recipients.length} destinatarios. No se pudo enviar a: ${failedNames}.`
        );
        setRecipients(failed.map((f) => f.userId));
        onSuccess?.();
      } else {
        setMsg(
          recipients.length === 1
            ? "Enviado correctamente."
            : `Enviado correctamente a ${okCount} destinatarios.`
        );
        setTitle("");
        setMessage("");
        setExpediente(null);
        setFile(null);
        setRecipients([]);
        onSuccess?.();
      }
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
          <p className="helper">Enviá cédulas, oficios y documentos a otro usuario del estudio.</p>
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

            <div className="bandeja-composer-row is-stack">
              <span className="bandeja-composer-label" style={{ paddingTop: 4 }}>
                Para
              </span>
              <RecipientMultiSelect
                users={users}
                value={recipients}
                onChange={setRecipients}
                disabled={sending}
                excludeUserId={currentUserId}
              />
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
              <ExpedienteAutocomplete
                value={expediente}
                onChange={setExpediente}
                disabled={sending}
              />
            </div>

            <div className="bandeja-composer-row is-stack">
              <span className="bandeja-composer-label" style={{ paddingTop: 4 }}>
                Mensaje
              </span>
              <div>
                <textarea
                  className="bandeja-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Escribí el mensaje o indicaciones para el destinatario..."
                  disabled={sending}
                />
                <p className="bandeja-message-hint">
                  Fase 2: el mensaje se persistirá en el envío. Hoy se usa el asunto y la notificación
                  automática del sistema.
                </p>
              </div>
            </div>

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
                accept=".docx,.pdf,.png,.jpg,.jpeg,.zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,image/png,image/jpeg,application/zip,application/x-zip-compressed"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                disabled={sending}
              />
              <div className="bandeja-dropzone-title">
                Arrastrá un archivo o hacé click para adjuntar
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
                <dt>Destinatarios</dt>
                <dd>
                  {recipientProfiles.length > 0
                    ? formatRecipientsSummary(recipients, users)
                    : "—"}
                  {recipientProfiles.length > 1 && (
                    <span className="bandeja-summary-sub">{recipientProfiles.length} en total</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>{docTypeLabel(docType)}</dd>
              </div>
              <div>
                <dt>Asunto</dt>
                <dd>{title.trim() || "—"}</dd>
              </div>
              <div>
                <dt>Expediente</dt>
                <dd>
                  {expediente ? (
                    <>
                      <strong>{expediente.label}</strong>
                      {expediente.caratula && (
                        <span className="bandeja-summary-sub">{expediente.caratula}</span>
                      )}
                    </>
                  ) : (
                    "Opcional — sin seleccionar"
                  )}
                </dd>
              </div>
              <div>
                <dt>Adjunto</dt>
                <dd>{file ? `${file.name} (${formatFileSize(file.size)})` : "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="bandeja-summary-card bandeja-summary-tips">
            <h3>Ayuda</h3>
            <ul>
              <li>El expediente es opcional; buscá por número o carátula.</li>
              <li>La descarga siempre trae la última versión del archivo.</li>
              <li>Cada destinatario recibirá su propia notificación y copia del archivo.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
