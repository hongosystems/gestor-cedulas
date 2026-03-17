"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Lote = {
  id: string;
  numero_lote: number;
  estado: string;
  umbral: number;
  destinatarios: string[];
  texto_mail: string;
  envio_automatico: boolean;
  fecha_envio: string | null;
  created_at: string;
  items: { id: string; mediacion_id: string; documento_id: string | null; mediaciones?: { id: string; numero_tramite: string | null; estado: string; req_nombre: string | null; objeto_reclamo: string | null } }[];
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

async function requireSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login";
    return null;
  }
  return data.session;
}

export default function LoteDetailPage() {
  const params = useParams();
  const loteId = params.loteId as string;
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [lote, setLote] = useState<Lote | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const res = await fetch(`/api/mediaciones/lotes/${loteId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json.error || "Lote no encontrado");
        setLoading(false);
        return;
      }
      setLote(json.data);
      setLoading(false);
    })();
  }, [loteId]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  async function marcarEnviado() {
    const session = await requireSessionOrRedirect();
    if (!session || !lote) return;
    setEnviando(true);
    setMsg("");
    const res = await fetch(`/api/mediaciones/lotes/${loteId}/enviar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json().catch(() => ({}));
    setEnviando(false);
    if (!res.ok) {
      setMsg(json.error || "Error");
      return;
    }
    setLote((prev) => (prev ? { ...prev, estado: "enviado", fecha_envio: json.data?.fecha_envio || new Date().toISOString() } : null));
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page"><p className="helper">Cargando…</p></div>
        </section>
      </main>
    );
  }

  if (!lote) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <p className="error">{msg || "Lote no encontrado"}</p>
            <Link className="btn" href="/app/mediaciones/lotes">Volver a lotes</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <div style={{ display: "flex", alignItems: "center", gap: 16, position: "relative" }}>
            <button onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }} style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 8, padding: "8px 10px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, alignItems: "center", justifyContent: "center", minWidth: 40, minHeight: 40 }}>
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
            </button>
            {menuOpen && (
              <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "100%", left: 0, marginTop: 8, background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12, padding: "12px 0", minWidth: 220, boxShadow: "0 8px 24px rgba(0,0,0,.4)", zIndex: 1000 }}>
                <Link href="/app/mediaciones" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>📋 Mediaciones</Link>
                <Link href="/app/mediaciones/nueva" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>➕ Nueva mediación</Link>
                <Link href="/app/mediaciones/lotes" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>📦 Lotes</Link>
                <Link href="/superadmin" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>🏠 Inicio</Link>
                <button onClick={() => { setMenuOpen(false); logout(); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 20px", color: "var(--brand-red)", background: "transparent", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>🚪 Salir</button>
              </div>
            )}
          </div>
          <img className="logoMini" src="/logo.png" alt="Logo" style={{ marginLeft: 12 }} />
          <h1>Lote #{lote.numero_lote}</h1>
          <div className="spacer" />
          {lote.estado === "abierto" && (
            <button className="btn primary" onClick={marcarEnviado} disabled={enviando}>{enviando ? "…" : "Marcar como enviado"}</button>
          )}
          <Link className="btn" href="/app/mediaciones/lotes">Volver a lotes</Link>
        </header>

        <div className="page">
          {msg && <div className="error">{msg}</div>}

          <p style={{ marginBottom: 16 }}><strong>Estado:</strong> {lote.estado} · <strong>Umbral:</strong> {lote.umbral} · <strong>Creado:</strong> {formatDateTime(lote.created_at)} · {lote.fecha_envio && <><strong>Envío:</strong> {formatDateTime(lote.fecha_envio)}</>}</p>
          <p className="muted" style={{ marginBottom: 16 }}><strong>Destinatarios:</strong> {lote.destinatarios?.join(", ") || "—"}</p>
          <p className="muted" style={{ marginBottom: 24, whiteSpace: "pre-wrap" }}><strong>Texto mail:</strong><br />{lote.texto_mail || "—"}</p>

          <h3 style={{ marginBottom: 8 }}>Mediaciones en el lote</h3>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nº Trámite</th>
                  <th>Requirente</th>
                  <th>Objeto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(lote.items || []).map((item) => (
                  <tr key={item.id}>
                    <td>{item.mediaciones?.numero_tramite || item.mediacion_id}</td>
                    <td>{item.mediaciones?.req_nombre || "—"}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.mediaciones?.objeto_reclamo || "—"}</td>
                    <td>{item.mediaciones?.estado || "—"}</td>
                    <td><Link className="btn" href={`/app/mediaciones/${item.mediacion_id}`}>Ver mediación</Link></td>
                  </tr>
                ))}
                {(lote.items || []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">No hay mediaciones en este lote. Agregá desde el detalle de cada mediación («Agregar a lote»).</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
