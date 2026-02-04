"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Transfer = {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  doc_type: "CEDULA" | "OFICIO";
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
                    <td>{t.doc_type === "CEDULA" ? "Cédula" : "Oficio"}</td>
                    <td>{displayName(profiles[t.sender_user_id])}</td>
                    <td>{t.title || "-"}</td>
                    <td>{fmtDate(t.created_at)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn" onClick={() => download(t.id)}>
                        Descargar
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
                    <td>{t.doc_type === "CEDULA" ? "Cédula" : "Oficio"}</td>
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
    </main>
  );
}
