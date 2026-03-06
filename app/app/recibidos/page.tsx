"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Transfer = {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  doc_type: "CEDULA" | "OFICIO" | "OTROS_ESCRITOS";
  title: string | null;
  created_at: string;
};

type Profile = { id: string; full_name: string | null; email: string | null };

function displayName(p?: Profile) {
  const name = (p?.full_name || "").trim();
  if (name) return name;
  const email = (p?.email || "").trim();
  if (email) return email;
  return "Sin nombre";
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

export default function RecibidosPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [uid, setUid] = useState<string>("");
  const [items, setItems] = useState<Transfer[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [uploadingId, setUploadingId] = useState<string>("");
  const [redirectingId, setRedirectingId] = useState<string>("");
  const [showRedirectModal, setShowRedirectModal] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [redirectRecipient, setRedirectRecipient] = useState<string>("");
  const [redirectMessage, setRedirectMessage] = useState<string>("");

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
      (profs ?? []).forEach((p: any) => (map[p.id] = p));
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

  const received = useMemo(() => items.filter((t) => t.recipient_user_id === uid), [items, uid]);
  const sent = useMemo(() => items.filter((t) => t.sender_user_id === uid), [items, uid]);

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

      setMsg("Versión subida ✅");
    } finally {
      setUploadingId("");
    }
  }

  function openRedirectModal(transfer: Transfer) {
    setSelectedTransfer(transfer);
    setRedirectRecipient("");
    setRedirectMessage("");
    setShowRedirectModal(true);
  }

  function closeRedirectModal() {
    setShowRedirectModal(false);
    setSelectedTransfer(null);
    setRedirectRecipient("");
    setRedirectMessage("");
  }

  async function handleRedirect() {
    if (!selectedTransfer) return;
    if (!redirectRecipient) {
      setMsg("Seleccioná un usuario destinatario");
      return;
    }

    setMsg("");
    setRedirectingId(selectedTransfer.id);

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
          transferId: selectedTransfer.id,
          newRecipientUserId: redirectRecipient,
          message: redirectMessage.trim() || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json?.error || "No se pudo redirigir el documento.");
        return;
      }

      setMsg("Documento redirigido exitosamente ✅");
      closeRedirectModal();
      
      // Recargar la lista de transferencias
      const { data, error } = await supabase
        .from("file_transfers")
        .select("id, sender_user_id, recipient_user_id, doc_type, title, created_at")
        .or(`recipient_user_id.eq.${uid},sender_user_id.eq.${uid}`)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setItems(data as Transfer[]);
      }
    } catch (error) {
      setMsg("Error al redirigir el documento");
    } finally {
      setRedirectingId("");
    }
  }

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <p className="helper">Cargando…</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>Recibidos / Enviados</h1>
          <div className="spacer" />
          <Link className="btn" href="/superadmin">
            Volver
          </Link>
          <Link className="btn" href="/app/enviar">
            Enviar
          </Link>
        </header>

        <div className="page">
          {msg && <div className={msg.includes("✅") ? "success" : "error"}>{msg}</div>}

          <h2 style={{ marginTop: 6 }}>Recibidos</h2>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Enviado por</th>
                  <th>Título</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {received.map((t) => (
                  <tr key={t.id}>
                    <td>{t.doc_type === "CEDULA" ? "Cédula" : t.doc_type === "OFICIO" ? "Oficio" : "Otros Escritos"}</td>
                    <td>{displayName(profiles[t.sender_user_id])}</td>
                    <td>{t.title || "-"}</td>
                    <td>{fmtDate(t.created_at)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn" onClick={() => download(t.id)}>
                        Descargar
                      </button>{" "}
                      <button className="btn" onClick={() => openRedirectModal(t)}>
                        Redirigir
                      </button>{" "}
                      <label className="btn">
                        {uploadingId === t.id ? "Subiendo…" : "Subir versión"}
                        <input
                          style={{ display: "none" }}
                          type="file"
                          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          onChange={(e) => uploadNewVersion(t.id, e.target.files?.[0] ?? null)}
                        />
                      </label>
                    </td>
                  </tr>
                ))}
                {received.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No tenés archivos recibidos aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: 18 }}>Enviados</h2>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Para</th>
                  <th>Título</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sent.map((t) => (
                  <tr key={t.id}>
                    <td>{t.doc_type === "CEDULA" ? "Cédula" : t.doc_type === "OFICIO" ? "Oficio" : "Otros Escritos"}</td>
                    <td>{displayName(profiles[t.recipient_user_id])}</td>
                    <td>{t.title || "-"}</td>
                    <td>{fmtDate(t.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn" onClick={() => download(t.id)}>
                        Descargar última versión
                      </button>
                    </td>
                  </tr>
                ))}
                {sent.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No enviaste archivos aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="helper" style={{ marginTop: 12 }}>
            La descarga siempre trae la <b>última versión</b>.
          </p>
        </div>
      </section>

      {/* Modal de Redirección */}
      {showRedirectModal && selectedTransfer && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
          onClick={closeRedirectModal}
        >
          <div
            style={{
              background: "linear-gradient(180deg, #0b2f55, #071c2e)",
              border: "1px solid rgba(255,255,255,.14)",
              borderRadius: "18px",
              boxShadow: "0 18px 40px rgba(0,0,0,.45)",
              padding: "24px",
              maxWidth: "520px",
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: 20, fontSize: "20px", letterSpacing: ".2px", color: "var(--text)" }}>
              Redirigir Documento
            </h2>
            
            <div style={{ marginBottom: 20, padding: "16px", background: "rgba(0,0,0,.18)", borderRadius: "12px", border: "1px solid rgba(255,255,255,.10)" }}>
              <div style={{ marginBottom: 12 }}>
                <span style={{ color: "rgba(234,243,255,.72)", fontSize: "14px", fontWeight: 600 }}>Tipo:</span>{" "}
                <span style={{ color: "var(--text)" }}>
                  {selectedTransfer.doc_type === "CEDULA"
                    ? "Cédula"
                    : selectedTransfer.doc_type === "OFICIO"
                    ? "Oficio"
                    : "Otros Escritos"}
                </span>
              </div>
              {selectedTransfer.title && (
                <div style={{ marginBottom: 12 }}>
                  <span style={{ color: "rgba(234,243,255,.72)", fontSize: "14px", fontWeight: 600 }}>Título:</span>{" "}
                  <span style={{ color: "var(--text)" }}>{selectedTransfer.title}</span>
                </div>
              )}
              <div>
                <span style={{ color: "rgba(234,243,255,.72)", fontSize: "14px", fontWeight: 600 }}>Enviado por:</span>{" "}
                <span style={{ color: "var(--text)" }}>{displayName(profiles[selectedTransfer.sender_user_id])}</span>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="label" style={{ display: "block", marginBottom: 8 }}>Redirigir a:</label>
              <select
                className="input"
                value={redirectRecipient}
                onChange={(e) => setRedirectRecipient(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">Seleccionar usuario…</option>
                {Object.values(profiles)
                  .filter((p) => p.id !== uid && p.id !== selectedTransfer.sender_user_id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {displayName(u)}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label className="label" style={{ display: "block", marginBottom: 8 }}>Mensaje (opcional):</label>
              <textarea
                className="input"
                value={redirectMessage}
                onChange={(e) => setRedirectMessage(e.target.value)}
                placeholder="Ej: Esta cédula es para un incidente, debería verla Guido o Maggie"
                rows={3}
                style={{ 
                  resize: "vertical",
                  width: "100%",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 24 }}>
              <button 
                className="btn" 
                onClick={closeRedirectModal} 
                disabled={redirectingId !== ""}
                style={{ minWidth: "100px" }}
              >
                Cancelar
              </button>
              <button
                className="btn primary"
                onClick={handleRedirect}
                disabled={!redirectRecipient || redirectingId !== ""}
                style={{ minWidth: "120px" }}
              >
                {redirectingId !== "" ? "Redirigiendo…" : "Redirigir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
