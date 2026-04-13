"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const TEXTO_MAIL_FIJO = `¿Como estan? Solicito fecha de mediacion . 

Tratar con Magaly Flores (mf.magaliflores@gmail.com) que es quien asiste a las audiencias.  

Adjunto los seis formularios.

Saludos Cordiales.`;

const DEFAULT_DESTINATARIOS =
  "oliverarodrigo86@gmail.com, gfhisi@gmail.com, mf.magaliflores@gmail.com, audiencias@estudiobustinduy.com";

const DEFAULT_DESTINATARIOS_LIST = DEFAULT_DESTINATARIOS.split(/[,;]/)
  .map((d) => d.trim())
  .filter(Boolean);

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
  items_count?: number;
};

type Pendiente = {
  id: string;
  numero_tramite: string | null;
  req_nombre: string | null;
  objeto_reclamo: string | null;
  created_at: string;
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

export default function MediacionLotesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [lotesEnviados, setLotesEnviados] = useState<Lote[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const [destinatarios, setDestinatarios] = useState(DEFAULT_DESTINATARIOS);
  const [umbral, setUmbral] = useState(56);
  const [envioAutomatico, setEnvioAutomatico] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const token = session.access_token;

      const [pendRes, lotesRes] = await Promise.all([
        fetch("/api/mediaciones/pendientes-despacho", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/mediaciones/lotes", { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (!pendRes.ok || !lotesRes.ok) {
        if (pendRes.status === 403 || lotesRes.status === 403) {
          router.replace("/app/mediaciones");
          return;
        }
        setMsg("Error al cargar datos");
        setLoading(false);
        return;
      }

      const pendJson = await pendRes.json().catch(() => ({}));
      const lotesJson = await lotesRes.json().catch(() => ({}));
      setPendientes(pendJson.data || []);
      setLotesEnviados((lotesJson.data || []).filter((l: Lote) => l.estado === "enviado"));
      setLoading(false);
    })();
  }, [router]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    if (selectedIds.size === pendientes.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(pendientes.map((p) => p.id)));
  };

  async function enviarLote() {
    const session = await requireSessionOrRedirect();
    if (!session || selectedIds.size === 0) return;

    setSending(true);
    setMsg("");
    const token = session.access_token;
    const destArray = destinatarios.split(/[,;]/).map((d) => d.trim()).filter(Boolean);
    const dest = destArray.length > 0 ? destArray : DEFAULT_DESTINATARIOS_LIST;

    const createRes = await fetch("/api/mediaciones/lotes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ umbral, destinatarios: dest, texto_mail: TEXTO_MAIL_FIJO, envio_automatico: envioAutomatico }),
    });
    const createJson = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createJson.data?.id) {
      setMsg(createJson.error || "Error al crear lote");
      setSending(false);
      return;
    }
    const loteId = createJson.data.id;

    const itemsRes = await fetch(`/api/mediaciones/lotes/${loteId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mediacion_ids: Array.from(selectedIds) }),
    });
    if (!itemsRes.ok) {
      const j = await itemsRes.json().catch(() => ({}));
      setMsg(j.error || "Error al agregar ítems");
      setSending(false);
      return;
    }

    const enviarRes = await fetch("/api/mediaciones/lotes/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lote_id: loteId }),
    });
    setSending(false);
    if (!enviarRes.ok) {
      const j = await enviarRes.json().catch(() => ({}));
      setMsg(j.error || "Error al enviar el lote");
      return;
    }

    setSelectedIds(new Set());
    setLotesEnviados((prev) => [{ ...createJson.data, estado: "enviado", fecha_envio: new Date().toISOString(), items_count: selectedIds.size }, ...prev]);
    setPendientes((prev) => prev.filter((p) => !selectedIds.has(p.id)));
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const linkStyle = { display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 };

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page"><p className="helper">Cargando…</p></div>
        </section>
      </main>
    );
  }

  const N = selectedIds.size;
  const progress = Math.min(pendientes.length, umbral);

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
                <Link href="/app/mediaciones" onClick={() => setMenuOpen(false)} style={linkStyle}>⚖️ Mediaciones</Link>
                <Link href="/app/mediaciones/nueva" onClick={() => setMenuOpen(false)} style={linkStyle}>➕ Nueva mediación</Link>
                <Link href="/app/mediaciones/lotes" onClick={() => setMenuOpen(false)} style={linkStyle}>📦 Despacho por lotes</Link>
                <Link href="/superadmin" onClick={() => setMenuOpen(false)} style={linkStyle}>🏠 Inicio</Link>
                <button onClick={() => { setMenuOpen(false); logout(); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 20px", color: "var(--brand-red)", background: "transparent", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>🚪 Salir</button>
              </div>
            )}
          </div>
          <img className="logoMini" src="/logo.png" alt="Logo" style={{ marginLeft: 12 }} />
          <h1>Despacho por lotes</h1>
          <div className="spacer" />
          <Link className="btn" href="/app/mediaciones">Volver a mediaciones</Link>
        </header>

        <div className="page">
          {msg && <div className="error">{msg}</div>}

          {/* Configuración */}
          <div style={{ marginBottom: 28, padding: 20, background: "rgba(0,0,0,.15)", borderRadius: 12 }}>
            <h3 style={{ marginBottom: 12 }}>Configuración</h3>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="label">Destinatarios (emails separados por coma)</label>
              <input className="input" value={destinatarios} onChange={(e) => setDestinatarios(e.target.value)} placeholder={DEFAULT_DESTINATARIOS} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div className="field" style={{ width: 100 }}>
                <label className="label">Umbral</label>
                <input className="input" type="number" min={1} value={umbral} onChange={(e) => setUmbral(Number(e.target.value) || 56)} />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={envioAutomatico} onChange={(e) => setEnvioAutomatico(e.target.checked)} />
                <span>Envío automático ON</span>
              </label>
            </div>
          </div>

          {/* Barra de progreso */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <strong>{pendientes.length}</strong>
              <span className="muted">/ {umbral} trámites con doc generado pendientes de despacho</span>
            </div>
            <div style={{ height: 10, background: "rgba(255,255,255,.1)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, (pendientes.length / umbral) * 100)}%`, height: "100%", background: "var(--brand-blue-2)", borderRadius: 999 }} />
            </div>
          </div>

          {/* Vista previa del mail */}
          <div style={{ marginBottom: 24, padding: 16, border: "1px solid var(--border)", borderRadius: 12 }}>
            <h3 style={{ marginBottom: 8 }}>Vista previa del mail</h3>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{TEXTO_MAIL_FIJO}</p>
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>Adjuntos: {N > 0 ? `${N} PDF(s) de los trámites seleccionados` : "Seleccione trámites para ver adjuntos."}</p>
          </div>

          {/* Tabla con checkboxes */}
          <h3 style={{ marginBottom: 12 }}>Trámites con documento generado (pendientes de despacho)</h3>
          <div style={{ marginBottom: 12 }}>
            <button type="button" className="btn" onClick={selectAll}>
              {selectedIds.size === pendientes.length && pendientes.length > 0 ? "Desmarcar todos" : "Seleccionar todos"}
            </button>
          </div>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}></th>
                  <th>N° Trámite</th>
                  <th>Requirente</th>
                  <th>Objeto</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleOne(p.id)}
                      />
                    </td>
                    <td><Link href={`/app/mediaciones/${p.id}`} style={{ color: "inherit" }}>{p.numero_tramite || p.id.slice(0, 8)}</Link></td>
                    <td>{p.req_nombre || "—"}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.objeto_reclamo || ""}>{p.objeto_reclamo || "—"}</td>
                  </tr>
                ))}
                {pendientes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">No hay trámites con doc generado pendientes de despacho.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pendientes.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <button
                className="btn primary"
                onClick={enviarLote}
                disabled={sending || N === 0}
                style={{ padding: "12px 24px", fontSize: 16 }}
              >
                {sending ? "Enviando…" : `Enviar lote (${N})`}
              </button>
            </div>
          )}

          {/* Historial de lotes enviados */}
          <h3 style={{ marginTop: 32, marginBottom: 12 }}>Historial de lotes enviados</h3>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nº Lote</th>
                  <th>Fecha envío</th>
                  <th>Cantidad</th>
                  <th>Destinatarios</th>
                </tr>
              </thead>
              <tbody>
                {lotesEnviados.map((l) => (
                  <tr key={l.id}>
                    <td><strong>#{l.numero_lote}</strong></td>
                    <td>{formatDateTime(l.fecha_envio)}</td>
                    <td>{l.items_count ?? "—"}</td>
                    <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.destinatarios?.join(", ")}>{l.destinatarios?.join(", ") || "—"}</td>
                  </tr>
                ))}
                {lotesEnviados.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">Aún no hay lotes enviados.</td>
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
