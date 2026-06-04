"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  displayName,
  docTypeLabel,
  fmtDateShort,
  fmtRelativeTime,
  type Profile,
} from "@/lib/bandeja-utils";
import {
  normalizeTransferRow,
  transferHasAttachment,
  transferMatchesQuery,
  transferSubject,
  type TransferSearchRow,
} from "@/lib/bandeja-search";

type Transfer = TransferSearchRow & { created_at: string };

const TRANSFER_SELECT =
  "id, sender_user_id, recipient_user_id, doc_type, title, message, expediente_ref, expediente_caratula, expediente_juzgado, created_at, file_transfer_versions(storage_path)";

const TRANSFER_SELECT_LEGACY =
  "id, sender_user_id, recipient_user_id, doc_type, title, created_at, file_transfer_versions(storage_path)";

function mapTransferRows(data: Record<string, unknown>[] | null): Transfer[] {
  return (data ?? []).map((row) => ({
    ...normalizeTransferRow(row),
    created_at: String(row.created_at ?? ""),
  }));
}

async function fetchTransfersForUser(userId: string) {
  const full = await supabase
    .from("file_transfers")
    .select(TRANSFER_SELECT)
    .or(`recipient_user_id.eq.${userId},sender_user_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (!full.error) {
    return { data: mapTransferRows(full.data as Record<string, unknown>[]), error: null as string | null };
  }

  const errMsg = full.error.message || "";
  const missingCols = /message|expediente_caratula|expediente_juzgado|column/i.test(errMsg);
  if (!missingCols) {
    return { data: [] as Transfer[], error: errMsg };
  }

  const legacy = await supabase
    .from("file_transfers")
    .select(TRANSFER_SELECT_LEGACY)
    .or(`recipient_user_id.eq.${userId},sender_user_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (legacy.error) {
    return { data: [] as Transfer[], error: legacy.error.message };
  }

  return {
    data: mapTransferRows(legacy.data as Record<string, unknown>[]),
    error:
      "Búsqueda por mensaje requiere la migración add_file_transfers_message.sql en Supabase.",
  };
}

type TransfersInboxProps = {
  mode: "recibidos" | "enviados";
  searchQuery?: string;
};

export default function TransfersInbox({ mode, searchQuery = "" }: TransfersInboxProps) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [uid, setUid] = useState("");
  const [items, setItems] = useState<Transfer[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [uploadingId, setUploadingId] = useState("");
  const [redirectingId, setRedirectingId] = useState("");
  const [showRedirectModal, setShowRedirectModal] = useState(false);
  const [redirectRecipient, setRedirectRecipient] = useState("");
  const [redirectMessage, setRedirectMessage] = useState("");
  const query = searchQuery;

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }
      const userId = sess.session.user.id;
      setUid(userId);

      const { data: profs } = await supabase.from("profiles").select("id, full_name, email");
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p: Profile) => {
        map[p.id] = p;
      });
      setProfiles(map);

      const { data, error } = await fetchTransfersForUser(userId);

      if (error) {
        setMsg(error);
      }

      setItems(data);
      setLoading(false);
    })();
  }, []);

  const list = useMemo(() => {
    const base =
      mode === "recibidos"
        ? items.filter((t) => t.recipient_user_id === uid)
        : items.filter((t) => t.sender_user_id === uid);

    if (!query.trim()) return base;
    return base.filter((t) => transferMatchesQuery(t, query, mode, profiles));
  }, [items, mode, uid, query, profiles]);

  async function reloadItems() {
    const { data, error } = await fetchTransfersForUser(uid);
    if (error) setMsg(error);
    setItems(data);
  }

  async function download(transferId: string) {
    setMsg("");
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return (window.location.href = "/login");

    const res = await fetch("/api/transfers/sign-download", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ transferId }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(json?.error || "No se pudo descargar.");
    window.open(json.url, "_blank");
  }

  async function uploadNewVersion(transferId: string, file: File | null) {
    setMsg("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) return setMsg("Solo .docx");

    setUploadingId(transferId);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const fd = new FormData();
      fd.append("transferId", transferId);
      fd.append("file", file);

      const res = await fetch("/api/transfers/upload-version", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg(json?.error || "No se pudo subir la versión.");
      setMsg("Versión subida correctamente.");
    } finally {
      setUploadingId("");
    }
  }

  async function handleRedirect() {
    if (!selected) return;
    if (!redirectRecipient) {
      setMsg("Seleccioná un usuario destinatario");
      return;
    }

    setMsg("");
    setRedirectingId(selected.id);

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const res = await fetch("/api/transfers/redirect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          transferId: selected.id,
          newRecipientUserId: redirectRecipient,
          message: redirectMessage.trim() || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json?.error || "No se pudo redirigir el documento.");
        return;
      }

      setMsg("Documento redirigido correctamente.");
      setShowRedirectModal(false);
      setRedirectRecipient("");
      setRedirectMessage("");
      setSelected(null);
      await reloadItems();
    } catch {
      setMsg("Error al redirigir el documento");
    } finally {
      setRedirectingId("");
    }
  }

  if (loading) {
    return <p className="helper">Cargando documentos…</p>;
  }

  const isReceived = mode === "recibidos";
  const selectedHasFile = selected ? transferHasAttachment(selected) : false;

  return (
    <>
      {msg && (
        <div
          className={msg.includes("correctamente") ? "success" : "error"}
          style={{ marginBottom: 12 }}
        >
          {msg}
        </div>
      )}

      <div className={`bandeja-split${selected ? " is-detail-open" : " is-list-only"}`}>
        <div className="bandeja-list">
          {list.length === 0 ? (
            <div className="bandeja-empty">
              {query.trim() && items.length > 0
                ? `Sin resultados para “${query.trim()}”.`
                : mode === "recibidos"
                  ? "No tenés documentos recibidos."
                  : "No enviaste documentos aún."}
            </div>
          ) : (
            list.map((t) => {
              const peerId = isReceived ? t.sender_user_id : t.recipient_user_id;
              const peerLabel = isReceived ? "De" : "Para";
              const subject = transferSubject(t);
              const hasFile = transferHasAttachment(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`bandeja-row${selected?.id === t.id ? " is-selected" : ""}`}
                  onClick={() => setSelected(t)}
                >
                  <span className="bandeja-row-type">{docTypeLabel(t.doc_type)}</span>
                  <div className="bandeja-row-main">
                    <div className="bandeja-row-subject">{subject}</div>
                    <div className="bandeja-row-meta">
                      {peerLabel}: {displayName(profiles[peerId])}
                      {t.expediente_ref ? ` · ${t.expediente_ref}` : ""}
                    </div>
                    {t.message && (
                      <div className="bandeja-row-preview">{t.message.replace(/\s+/g, " ").trim()}</div>
                    )}
                  </div>
                  {hasFile ? (
                    <span className="bandeja-row-attach" title="Con adjunto">
                      📎
                    </span>
                  ) : (
                    <span className="bandeja-row-attach bandeja-row-attach--muted" title="Solo mensaje">
                      💬
                    </span>
                  )}
                  <div className="bandeja-row-aside">
                    <span className="bandeja-row-date">{fmtRelativeTime(t.created_at)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {selected && (
          <div className="bandeja-detail">
            <div className="bandeja-detail-header">
              <button
                type="button"
                className="btn bandeja-mobile-back"
                onClick={() => setSelected(null)}
              >
                ← Volver a la lista
              </button>
              <h3 className="bandeja-detail-title">{transferSubject(selected)}</h3>
              <div className="bandeja-detail-meta">
                <div>
                  <strong>Tipo:</strong> {docTypeLabel(selected.doc_type)}
                </div>
                <div>
                  <strong>{isReceived ? "Enviado por" : "Destinatario"}:</strong>{" "}
                  {displayName(
                    profiles[isReceived ? selected.sender_user_id : selected.recipient_user_id]
                  )}
                </div>
                {selected.expediente_ref && (
                  <div>
                    <strong>Expediente:</strong> {selected.expediente_ref}
                    {selected.expediente_caratula && (
                      <span className="bandeja-detail-exp-meta"> — {selected.expediente_caratula}</span>
                    )}
                  </div>
                )}
                <div>
                  <strong>Fecha:</strong> {fmtDateShort(selected.created_at)} (
                  {fmtRelativeTime(selected.created_at)})
                </div>
              </div>
            </div>

            <div className="bandeja-detail-actions">
              {selectedHasFile && (
                <button type="button" className="btn primary" onClick={() => download(selected.id)}>
                  Descargar {isReceived ? "" : "última versión"}
                </button>
              )}
              {isReceived && selectedHasFile && (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setRedirectRecipient("");
                      setRedirectMessage("");
                      setShowRedirectModal(true);
                    }}
                  >
                    Redirigir
                  </button>
                  <label className="btn">
                    {uploadingId === selected.id ? "Subiendo…" : "Subir versión"}
                    <input
                      style={{ display: "none" }}
                      type="file"
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(e) =>
                        uploadNewVersion(selected.id, e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                </>
              )}
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                Cerrar
              </button>
            </div>

            <div className="bandeja-detail-body">
              {selected.message ? (
                <div className="bandeja-detail-message">{selected.message}</div>
              ) : (
                <p className="helper" style={{ margin: 0 }}>
                  Este envío no incluye mensaje de texto.
                </p>
              )}
              {selectedHasFile ? (
                <p className="helper" style={{ margin: selected.message ? "12px 0 0" : 0 }}>
                  La descarga trae la <strong>última versión</strong> del archivo adjunto.
                  {isReceived && " Podés redirigirlo o subir una nueva versión en .docx."}
                </p>
              ) : (
                <p className="helper" style={{ margin: selected.message ? "12px 0 0" : 0 }}>
                  Envío solo mensaje, sin archivo adjunto.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {showRedirectModal && selected && isReceived && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setShowRedirectModal(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 520, width: "100%", padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>Redirigir documento</h2>
            <p className="helper">
              {docTypeLabel(selected.doc_type)}
              {selected.title ? ` — ${selected.title}` : ""}
            </p>

            <div style={{ marginBottom: 16 }}>
              <label className="label">Redirigir a</label>
              <select
                className="input"
                value={redirectRecipient}
                onChange={(e) => setRedirectRecipient(e.target.value)}
              >
                <option value="">Seleccionar usuario…</option>
                {Object.values(profiles)
                  .filter((p) => p.id !== uid && p.id !== selected.sender_user_id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {displayName(u)}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label className="label">Mensaje (opcional)</label>
              <textarea
                className="input"
                value={redirectMessage}
                onChange={(e) => setRedirectMessage(e.target.value)}
                rows={3}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowRedirectModal(false)}
                disabled={redirectingId !== ""}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleRedirect}
                disabled={!redirectRecipient || redirectingId !== ""}
              >
                {redirectingId !== "" ? "Redirigiendo…" : "Redirigir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
