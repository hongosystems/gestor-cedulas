"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Mediacion = {
  id: string;
  numero_tramite: string | null;
  estado: string;
  user_id: string;
  created_at: string;
  fecha_envio: string | null;
  fecha_ultima_actualizacion: string;
  tracking_externo_id: string | null;
  letrado_nombre: string | null;
  letrado_caracter: string | null;
  letrado_tomo: string | null;
  letrado_folio: string | null;
  letrado_domicilio: string | null;
  letrado_telefono: string | null;
  letrado_celular: string | null;
  letrado_email: string | null;
  req_nombre: string | null;
  req_dni: string | null;
  req_domicilio: string | null;
  req_email: string | null;
  req_celular: string | null;
  objeto_reclamo: string | null;
  fecha_hecho: string | null;
  lugar_hecho: string | null;
  vehiculo: string | null;
  dominio_patente: string | null;
  nro_siniestro: string | null;
  nro_poliza: string | null;
  mecanica_hecho: string | null;
  linea_interno?: string | null;
  articulo?: string | null;
  intervino?: string | null;
  lesiones_ambos?: string | null;
  requeridos?: any[];
  requirentes?: {
    id: string;
    nombre: string;
    dni: string | null;
    domicilio: string | null;
    email: string | null;
    celular: string | null;
    orden: number;
  }[];
  observaciones?: { id: string; texto: string; autor_id: string; created_at: string; autor?: { full_name?: string; email?: string } }[];
  historial?: { id: string; estado_anterior: string | null; estado_nuevo: string; actor_id: string; comentario: string | null; created_at: string; actor?: { full_name?: string; email?: string } }[];
  documentos?: { id: string; tipo_plantilla: string; storage_path: string; modo_firma: string; created_at: string }[];
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = iso.substring(0, 10);
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

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

function Section({
  title,
  open,
  onToggle,
  children,
  editHref,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  editHref?: string;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, marginBottom: 12, overflow: "hidden" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          padding: "14px 18px",
          background: "rgba(255,255,255,.06)",
          border: "none",
          color: "var(--text)",
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <span>{title}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {editHref && (
              <Link
                href={editHref}
                aria-label="Editar mediación"
                title="Editar"
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: 8,
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(255,255,255,.16)",
                  color: "var(--text)",
                  textDecoration: "none",
                  cursor: "pointer",
                  userSelect: "none",
                  fontSize: 14,
                  lineHeight: "22px",
                }}
              >
                ✏️
              </Link>
            )}
            <span style={{ fontSize: 18 }}>{open ? "−" : "+"}</span>
          </span>
        </span>
      </button>
      {open && <div style={{ padding: "16px 18px", borderTop: "1px solid var(--border)" }}>{children}</div>}
    </div>
  );
}

export default function MediacionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [mediacion, setMediacion] = useState<Mediacion | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openLetrado, setOpenLetrado] = useState(true);
  const [openRequirente, setOpenRequirente] = useState(true);
  const [openRequeridos, setOpenRequeridos] = useState(true);
  const [openHecho, setOpenHecho] = useState(true);
  const [modalDevolver, setModalDevolver] = useState(false);
  const [textoDevolver, setTextoDevolver] = useState("");
  const [sendingDevolver, setSendingDevolver] = useState(false);
  const [sendingAceptar, setSendingAceptar] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const token = session.access_token;
      const res = await fetch(`/api/mediaciones/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json.error || "Error al cargar");
        setLoading(false);
        return;
      }
      setMediacion(json.data);
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  async function devolverConObservaciones() {
    const session = await requireSessionOrRedirect();
    if (!session || !textoDevolver.trim()) return;
    setSendingDevolver(true);
    setMsg("");
    const [obsRes, patchRes] = await Promise.all([
      fetch(`/api/mediaciones/${id}/observaciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ texto: textoDevolver.trim() }),
      }),
      fetch(`/api/mediaciones/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ estado: "devuelto" }),
      }),
    ]);
    setSendingDevolver(false);
    setModalDevolver(false);
    setTextoDevolver("");
    if (!patchRes.ok) {
      const j = await patchRes.json().catch(() => ({}));
      setMsg(j.error || "Error al devolver");
      return;
    }
    setMediacion((prev) => prev ? { ...prev, estado: "devuelto" } : null);
    const obsJson = await obsRes.json().catch(() => ({}));
    if (obsRes.ok && obsJson.data) {
      setMediacion((prev) => prev ? { ...prev, observaciones: [obsJson.data, ...(prev.observaciones || [])] } : null);
    }
  }

  async function aceptar() {
    const session = await requireSessionOrRedirect();
    if (!session) return;
    setSendingAceptar(true);
    setMsg("");
    const res = await fetch(`/api/mediaciones/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ estado: "aceptado" }),
    });
    setSendingAceptar(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error || "Error al aceptar");
      return;
    }
    setMediacion((prev) => prev ? { ...prev, estado: "aceptado" } : null);
  }

  async function generarDocumento() {
    const session = await requireSessionOrRedirect();
    if (!session) return;
    setGeneratingPdf(true);
    setMsg("");
    const res = await fetch(`/api/mediaciones/${id}/generate-doc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ tipo_plantilla: "formulario_mediacion", modo_firma: "sin_firma" }),
    });
    const json = await res.json().catch(() => ({}));
    setGeneratingPdf(false);
    if (!res.ok) {
      setMsg(json.error || "Error al generar PDF");
      return;
    }
    const docId = json.data?.documento_id || json.data?.id;
    setMediacion((prev) => (prev && json.data ? { ...prev, documentos: [json.data, ...(prev.documentos || [])], estado: "doc_generado" } : prev));
    // `download` requiere auth; por eso no usamos window.open directo (el navegador no manda headers).
    if (docId) {
      try {
        const downloadRes = await fetch(`/api/mediaciones/download?documento_id=${docId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!downloadRes.ok) {
          const text = await downloadRes.text();
          setMsg(text || "Error al descargar el PDF");
          return;
        }
        const blob = await downloadRes.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch {
        setMsg("Error al descargar el PDF");
      }
    }
  }

  async function verDocumento() {
    const session = await requireSessionOrRedirect();
    if (!session || !docPrincipal) return;
    try {
      const res = await fetch(`/api/mediaciones/download?documento_id=${docPrincipal.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        setMsg(text || "Error al cargar el documento");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setMsg("Error al abrir el documento");
    }
  }

  async function descargarPdf() {
    const session = await requireSessionOrRedirect();
    if (!session || !docPrincipal) return;
    setMsg("");
    try {
      const res = await fetch(`/api/mediaciones/download?documento_id=${docPrincipal.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        setMsg(text || "Error al descargar el PDF");
        return;
      }
      const blob = await res.blob();
      const filename = res.headers.get("Content-Disposition")?.match(/filename="?([^";\n]+)"?/)?.[1] || `mediacion-${mediacion?.numero_tramite || id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg("Error al descargar el PDF");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const linkStyle = { display: "block", padding: "12px 20px", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600, transition: "background 0.2s ease", borderLeft: "3px solid transparent" };

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page"><p className="helper">Cargando…</p></div>
        </section>
      </main>
    );
  }

  if (!mediacion) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <p className="error">{msg || "Mediación no encontrada"}</p>
            <Link className="btn" href="/app/mediaciones">Volver a bandeja</Link>
          </div>
        </section>
      </main>
    );
  }

  const ultimaObservacion = mediacion.observaciones?.[0];
  const docPrincipal = mediacion.documentos?.[0];

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
                <Link href="/app/mediaciones/lotes" onClick={() => setMenuOpen(false)} style={linkStyle}>📦 Lotes</Link>
                <Link href={`/app/mediaciones/${id}/editar`} onClick={() => setMenuOpen(false)} style={linkStyle}>✏️ Editar</Link>
                <Link href="/superadmin" onClick={() => setMenuOpen(false)} style={linkStyle}>🏠 Inicio</Link>
                <button onClick={() => { setMenuOpen(false); logout(); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 20px", color: "var(--brand-red)", background: "transparent", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>🚪 Salir</button>
              </div>
            )}
          </div>
          <img className="logoMini" src="/logo.png" alt="Logo" style={{ marginLeft: 12 }} />
          <h1>{mediacion.req_nombre || mediacion.numero_tramite || "Mediación"}</h1>
          <div className="spacer" />
          <Link className="btn" href="/app/mediaciones">Volver</Link>
        </header>

        <div className="page">
          {msg && <div className="error">{msg}</div>}

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 400px", minWidth: 0 }}>
              <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, background: "rgba(255,255,255,.12)", textTransform: "capitalize" }}>{mediacion.estado.replace(/_/g, " ")}</span>
                <span className="muted">{mediacion.numero_tramite}</span>
              </div>

              {mediacion.estado === "devuelto" && ultimaObservacion && (
                <div style={{ marginBottom: 20, padding: 16, background: "rgba(241,196,15,.12)", border: "1px solid rgba(241,196,15,.35)", borderRadius: 12 }}>
                  <strong>Observación (devolución):</strong>
                  <p style={{ margin: "8px 0 0 0", whiteSpace: "pre-wrap" }}>{ultimaObservacion.texto}</p>
                  <span className="muted" style={{ fontSize: 12 }}>{ultimaObservacion.autor?.full_name || ultimaObservacion.autor?.email} · {formatDateTime(ultimaObservacion.created_at)}</span>
                </div>
              )}

              <Section title="Letrado" open={openLetrado} onToggle={() => setOpenLetrado(!openLetrado)} editHref={`/app/mediaciones/${id}/editar`}>
                <p><strong>{mediacion.letrado_nombre || "—"}</strong> {mediacion.letrado_caracter && `(${mediacion.letrado_caracter})`}</p>
                <p className="muted">Tomo/Folio: {mediacion.letrado_tomo && mediacion.letrado_folio ? `${mediacion.letrado_tomo} / ${mediacion.letrado_folio}` : "—"}</p>
                <p className="muted">{mediacion.letrado_domicilio || "—"}</p>
                <p className="muted">{[mediacion.letrado_telefono, mediacion.letrado_celular, mediacion.letrado_email].filter(Boolean).join(" · ") || "—"}</p>
              </Section>

              <Section
                title={(mediacion.requirentes || []).length > 1 ? "Requirente/s" : "Requirente"}
                open={openRequirente}
                onToggle={() => setOpenRequirente(!openRequirente)}
                editHref={`/app/mediaciones/${id}/editar`}
              >
                {(mediacion.requirentes || []).length > 0 ? (
                  <ul style={{ paddingLeft: 20, margin: 0, overflowX: "hidden", wordBreak: "break-word", overflowWrap: "break-word" }}>
                    {(mediacion.requirentes || []).map((r, i) => (
                      <li key={r.id || i} style={{ marginBottom: 8 }}>
                        <strong>{r.nombre?.trim() || "—"}</strong>
                        {r.dni?.trim() ? ` · DNI ${r.dni}` : ""}
                        {r.domicilio?.trim() ? ` · Domicilio: ${r.domicilio}` : ""}
                        {[r.email, r.celular].filter((x) => x != null && String(x).trim() !== "").length > 0
                          ? ` · ${[r.email, r.celular].filter((x) => x != null && String(x).trim() !== "").join(" · ")}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <>
                    <p style={{ wordBreak: "break-word", overflowWrap: "break-word" }}>
                      <strong>{mediacion.req_nombre || "—"}</strong> {mediacion.req_dni && `DNI ${mediacion.req_dni}`}
                    </p>
                    <p className="muted" style={{ wordBreak: "break-word", overflowWrap: "break-word" }}>{mediacion.req_domicilio || "—"}</p>
                    <p className="muted" style={{ wordBreak: "break-word", overflowWrap: "break-word" }}>
                      {[mediacion.req_email, mediacion.req_celular].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </>
                )}
              </Section>

              <Section title="Requerido/s" open={openRequeridos} onToggle={() => setOpenRequeridos(!openRequeridos)} editHref={`/app/mediaciones/${id}/editar`}>
                {(mediacion.requeridos || []).length === 0 ? <p className="muted">—</p> : (
                  <ul style={{ paddingLeft: 20, margin: 0, overflowX: "hidden", wordBreak: "break-word", overflowWrap: "break-word" }}>
                    {(mediacion.requeridos || []).map((r: any, i: number) => (
                      <li key={r.id || i}>
                        {r.nombre}
                        {r.empresa_nombre_razon_social && ` · ${r.empresa_nombre_razon_social}`}
                        {r.domicilio && ` · Domicilio: ${r.domicilio}`}
                        {r.lesiones && ` · Lesiones: ${r.lesiones}`}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Hecho y reclamo" open={openHecho} onToggle={() => setOpenHecho(!openHecho)} editHref={`/app/mediaciones/${id}/editar`}>
                <div style={{ overflowX: "hidden", wordBreak: "break-word", overflowWrap: "break-word" }}>
                  <p><strong>Objeto:</strong> {mediacion.objeto_reclamo || "—"}</p>
                  <p className="muted">Fecha: {formatDate(mediacion.fecha_hecho)} · Lugar: {mediacion.lugar_hecho || "—"}</p>
                  <p className="muted">Vehículo: {mediacion.vehiculo || "—"}{mediacion.linea_interno ? ` · Línea/Interno: ${mediacion.linea_interno}` : ""} · Dominio: {mediacion.dominio_patente || "—"}</p>
                  <p className="muted">Siniestro: {mediacion.nro_siniestro || "—"} · Póliza: {mediacion.nro_poliza || "—"}</p>
                  {(mediacion.articulo || mediacion.intervino) && (
                    <p className="muted">
                      {mediacion.articulo ? `Art: ${mediacion.articulo}` : ""}
                      {mediacion.articulo && mediacion.intervino ? " · " : ""}
                      {mediacion.intervino ? `Intervino: ${mediacion.intervino}` : ""}
                    </p>
                  )}
                  {mediacion.mecanica_hecho && (
                    <p style={{ marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}>{mediacion.mecanica_hecho}</p>
                  )}
                  {mediacion.lesiones_ambos && (
                    <p style={{ marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}>
                      <strong>Lesiones de ambos:</strong> {mediacion.lesiones_ambos}
                    </p>
                  )}
                </div>
              </Section>

              {/* Acciones por estado */}
              <div style={{ marginTop: 24, display: "flex", flexWrap: "wrap", gap: 12 }}>
                {(mediacion.estado === "pendiente_rta" || mediacion.estado === "reenviado") && (
                  <>
                    <button className="btn" onClick={() => setModalDevolver(true)}>Devolver con observaciones</button>
                    <button className="btn primary" onClick={aceptar} disabled={sendingAceptar}>{sendingAceptar ? "…" : "Aceptar"}</button>
                  </>
                )}
                {mediacion.estado === "aceptado" && (
                  <button className="btn primary" onClick={generarDocumento} disabled={generatingPdf}>{generatingPdf ? "Generando…" : "Generar documento"}</button>
                )}
                {mediacion.estado === "doc_generado" && docPrincipal && (
                  <>
                    <button type="button" className="btn" onClick={verDocumento}>Ver documento</button>
                    <button type="button" className="btn primary" onClick={descargarPdf}>Descargar PDF</button>
                  </>
                )}
              </div>
            </div>

            {/* Timeline historial */}
            <div style={{ width: 280, flexShrink: 0 }}>
              <h3 style={{ marginBottom: 12 }}>Historial</h3>
              <div style={{ borderLeft: "2px solid var(--border)", paddingLeft: 16, position: "relative" }}>
                
                {(mediacion.historial || []).map((h) => (
                  <div key={h.id} style={{ marginBottom: 16, position: "relative" }}>
                    <div
                      style={{
                        position: "absolute",
                        left: -21,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "var(--brand-blue-2)",
                        top: 4,
                      }}
                    />
                    <div style={{ fontSize: 13 }}>
                      {h.estado_anterior || "—"} → <strong>{h.estado_nuevo.replace(/_/g, " ")}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {h.actor?.full_name || h.actor?.email || "—"} · {formatDateTime(h.created_at)}
                    </div>
                    {h.comentario && <div style={{ fontSize: 12, marginTop: 4 }}>{h.comentario}</div>}
                  </div>
                ))}
                {(mediacion.historial || []).length === 0 && <p className="muted" style={{ fontSize: 13 }}>Sin eventos aún.</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modal Devolver */}
      {modalDevolver && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}
          onClick={() => setModalDevolver(false)}
        >
          <div
            style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 480, width: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: 12 }}>Devolver con observaciones</h3>
            <textarea
              className="input"
              rows={4}
              placeholder="Indique el motivo de la devolución..."
              value={textoDevolver}
              onChange={(e) => setTextoDevolver(e.target.value)}
              style={{ width: "100%", marginBottom: 16 }}
            />
            <div style={{ display: "flex", gap: 12 }}>
              <button className="btn primary" onClick={devolverConObservaciones} disabled={sendingDevolver || !textoDevolver.trim()}>{sendingDevolver ? "…" : "Devolver"}</button>
              <button className="btn" onClick={() => { setModalDevolver(false); setTextoDevolver(""); }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
