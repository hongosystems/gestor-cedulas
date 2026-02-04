"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Profile = { id: string; full_name: string | null; email: string | null };

function displayName(p: Profile) {
  const n = (p.full_name || "").trim();
  if (n) return n;
  const e = (p.email || "").trim();
  if (e) return e;
  return "Sin nombre";
}

export default function EnviarPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [recipient, setRecipient] = useState("");
  const [docType, setDocType] = useState<"CEDULA" | "OFICIO">("CEDULA");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }

      // Lista de usuarios: por simplicidad todos los profiles.
      // Si querés restringir a "admins" o a un grupo, se filtra acá.
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name", { ascending: true });

      if (error) {
        setMsg(error.message);
        setLoading(false);
        return;
      }

      setUsers((data ?? []) as Profile[]);
      setLoading(false);
    })();
  }, []);

  async function onSend() {
    setMsg("");

    if (!recipient) return setMsg("Elegí un usuario destinatario.");
    if (!file) return setMsg("Cargá un archivo .docx.");
    if (!file.name.toLowerCase().endsWith(".docx")) return setMsg("El archivo debe ser .docx.");

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

      setMsg("Enviado ✅");
      setTitle("");
      setFile(null);
      setRecipient("");
    } finally {
      setSending(false);
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
          <h1>Enviar Cédula/Oficio</h1>
          <div className="spacer" />
          <Link className="btn" href="/superadmin">
            Volver
          </Link>
        </header>

        <div className="page" style={{ display: "grid", gap: 12 }}>
          {msg && <div className={msg.includes("✅") ? "success" : "error"}>{msg}</div>}

          <div>
            <label className="label">Tipo</label>
            <select className="input" value={docType} onChange={(e) => setDocType(e.target.value as any)}>
              <option value="CEDULA">Cédula</option>
              <option value="OFICIO">Oficio</option>
            </select>
          </div>

          <div>
            <label className="label">Usuario destinatario</label>
            <select className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
              <option value="">Seleccionar…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {displayName(u)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Título (opcional)</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Oficio Banco X" />
          </div>

          <div>
            <label className="label">Archivo (.docx)</label>
            <input
              className="input"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="helper" style={{ marginTop: 6 }}>
              Se envía y se maneja siempre como .docx.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn primary" disabled={sending} onClick={onSend}>
              {sending ? "Enviando…" : "Enviar"}
            </button>
            <Link className="btn" href="/app/recibidos">
              Ver recibidos
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
