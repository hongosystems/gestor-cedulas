"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { displayName, docTypeLabel, type DocType, type Profile } from "@/lib/bandeja-utils";
import ExpedienteAutocomplete, { type ExpedienteOption } from "@/app/components/bandeja/ExpedienteAutocomplete";

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
  const [recipient, setRecipient] = useState("");
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
      setSenderName(displayName(me as Profile));
      setLoading(false);
    })();
  }, []);

  const recipientProfile = useMemo(
    () => users.find((u) => u.id === recipient) ?? null,
    [users, recipient]
  );

  const pickFile = useCallback((f: File | null) => {
    if (!f) return;
    setFile(f);
  }, []);

  async function onSend() {
    setMsg("");

    if (!recipient) return setMsg("Elegí un usuario destinatario.");
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

      const fd = new FormData();
      fd.append("recipient_user_id", recipient);
      fd.append("doc_type", docType);
      fd.append("title", title.trim());
      if (expediente?.ref) {
        fd.append("expediente_ref", expediente.ref);
      }
      fd.append("file", file);

      const res = await fetch("/api/transfers/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json?.error || "No se pudo enviar.");
        return;
      }

      setMsg("Enviado correctamente.");
      setTitle("");
      setMessage("");
      setExpediente(null);
      setFile(null);
      setRecipient("");
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

            <div className="bandeja-composer-row">
              <span className="bandeja-composer-label">Para</span>
              <select
                className="input"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                disabled={sending}
              >
                <option value="">Seleccionar destinatario…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {displayName(u)}
                  </option>
                ))}
              </select>
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
                <dt>Destinatario</dt>
                <dd>{recipientProfile ? displayName(recipientProfile) : "—"}</dd>
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
              <li>El destinatario recibirá una notificación en su bandeja.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
