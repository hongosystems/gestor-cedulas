"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  displayName,
  docTypeLabel,
  fmtDateShort,
  fmtRelativeTime,
  type DocType,
  type Profile,
} from "@/lib/bandeja-utils";

type Transfer = {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  doc_type: DocType;
  title: string | null;
  created_at: string;
};

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

      const { data, error } = await supabase
        .from("file_transfers")
        .select("id, sender_user_id, recipient_user_id, doc_type, title, created_at")
        .or(`recipient_user_id.eq.${userId},sender_user_id.eq.${userId}`)
        .order("created_at", { ascending: false });

      if (error) {
        setMsg(error.message);
        setLoading(false);
        return;
      }

      setItems((data ?? []) as Transfer[]);
      setLoading(false);
    })();
  }, []);

  const list = useMemo(() => {
    const base =
      mode === "recibidos"
        ? items.filter((t) => t.recipient_user_id === uid)
        : items.filter((t) => t.sender_user_id === uid);

    if (!query.trim()) return base;
    const q = query.trim().toLowerCase();
    return base.filter((t) => {
      const title = (t.title || "").toLowerCase();
      const type = docTypeLabel(t.doc_type).toLowerCase();
      const peer =
        mode === "recibidos"
          ? displayName(profiles[t.sender_user_id]).toLowerCase()
          : displayName(profiles[t.recipient_user_id]).toLowerCase();
      return title.includes(q) || type.includes(q) || peer.includes(q);
    });
  }, [items, mode, uid, query, profiles]);

  async function reloadItems() {
    const { data, error } = await supabase
      .from("file_transfers")
      .select("id, sender_user_id, recipient_user_id, doc_type, title, created_at")
      .or(`recipient_user_id.eq.${uid},sender_user_id.eq.${uid}`)
      .order("created_at", { ascending: false });
    if (!error && data) setItems(data as Transfer[]);
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
              {mode === "recibidos"
                ? "No tenés documentos recibidos."
                : "No enviaste documentos aún."}
            </div>
          ) : (
            list.map((t) => {
              const peerId = isReceived ? t.sender_user_id : t.recipient_user_id;
              const peerLabel = isReceived ? "De" : "Para";
              const subject = t.title || docTypeLabel(t.doc_type);
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
                    </div>
                  </div>
                  <span className="bandeja-row-attach" title="Adjunto">
                    📎
                  </span>
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
              <h3 className="bandeja-detail-title">
                {selected.title || docTypeLabel(selected.doc_type)}
              </h3>
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
                <div>
                  <strong>Fecha:</strong> {fmtDateShort(selected.created_at)} (
                  {fmtRelativeTime(selected.created_at)})
                </div>
              </div>
            </div>

            <div className="bandeja-detail-actions">
              <button type="button" className="btn primary" onClick={() => download(selected.id)}>
                Descargar {isReceived ? "" : "última versión"}
              </button>
              {isReceived && (
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
              <p className="helper" style={{ margin: 0 }}>
                La descarga siempre trae la <strong>última versión</strong> del archivo.
                {isReceived &&
                  " Podés redirigir el documento a otro usuario o subir una nueva versión en .docx."}
              </p>
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
