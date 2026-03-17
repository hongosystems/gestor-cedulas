"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import NotificationBell from "@/app/components/NotificationBell";

type MediacionRow = {
  id: string;
  numero_tramite: string | null;
  estado: string;
  user_id: string;
  created_at: string;
  fecha_envio: string | null;
  fecha_ultima_actualizacion: string;
  letrado_nombre: string | null;
  req_nombre: string | null;
  req_email: string | null;
  objeto_reclamo: string | null;
  fecha_hecho: string | null;
  mediacion_requeridos?: { nombre: string }[];
};

const ESTADOS = ["pendiente_rta", "devuelto", "reenviado", "aceptado", "doc_generado", "enviado", "borrador"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = iso.substring(0, 10);
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

async function requireSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login";
    return null;
  }
  return data.session;
}

const linkStyle = {
  display: "block",
  padding: "12px 20px",
  color: "var(--text)",
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 600,
  transition: "background 0.2s ease",
  borderLeft: "3px solid transparent",
};
const linkHover = (e: React.MouseEvent<HTMLAnchorElement>) => {
  e.currentTarget.style.background = "rgba(255,255,255,.08)";
  e.currentTarget.style.borderLeftColor = "var(--brand-blue-2)";
};
const linkLeave = (e: React.MouseEvent<HTMLAnchorElement>) => {
  e.currentTarget.style.background = "transparent";
  e.currentTarget.style.borderLeftColor = "transparent";
};

export default function MediacionesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [rows, setRows] = useState<MediacionRow[]>([]);
  const [estadoFilter, setEstadoFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdminMediaciones, setIsAdminMediaciones] = useState(false);
  const [currentUserName, setCurrentUserName] = useState("");

  useEffect(() => {
    (async () => {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;
      const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", uid).maybeSingle();
      setCurrentUserName(profile?.full_name?.trim() || profile?.email || session.user.email || "");

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("is_admin_mediaciones")
        .eq("user_id", uid)
        .maybeSingle();

      const admin = roleData?.is_admin_mediaciones === true;
      setIsAdminMediaciones(admin);

      if (!admin) {
        router.replace("/app");
        return;
      }

      const { data: list, error } = await supabase
        .from("mediaciones")
        .select("*, mediacion_requeridos(nombre)")
        .order("created_at", { ascending: false });

      if (error) {
        setMsg(error.message || "Error al cargar");
        setLoading(false);
        return;
      }
      setRows((list || []) as MediacionRow[]);
      setLoading(false);
    })();
  }, [router]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  const filteredRows = rows.filter((r) => {
    if (estadoFilter && r.estado !== estadoFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      (r.numero_tramite || "").toLowerCase().includes(q) ||
      (r.req_nombre || "").toLowerCase().includes(q) ||
      (r.req_email || "").toLowerCase().includes(q) ||
      (r.id || "").toLowerCase().includes(q) ||
      (r.mediacion_requeridos || []).some((req) => (req.nombre || "").toLowerCase().includes(q))
    );
  });

  const total = rows.length;
  const pendientes = rows.filter((r) => r.estado === "pendiente_rta").length;
  const devueltos = rows.filter((r) => r.estado === "devuelto").length;
  const reenviados = rows.filter((r) => r.estado === "reenviado").length;
  const aceptados = rows.filter((r) => r.estado === "aceptado").length;
  const enviados = rows.filter((r) => r.estado === "enviado").length;

  function badgeStyle(estado: string): React.CSSProperties {
    const base = { padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 };
    if (estado === "doc_generado") return { ...base, background: "rgba(46, 204, 113, 0.2)", color: "rgba(210, 255, 226, 0.95)" };
    if (estado === "enviado") return { ...base, background: "rgba(52, 152, 219, 0.25)", color: "rgba(174, 214, 241, 0.98)" };
    if (estado === "aceptado") return { ...base, background: "rgba(96, 141, 186, 0.3)", color: "var(--text)" };
    if (estado === "devuelto") return { ...base, background: "rgba(241, 196, 15, 0.2)", color: "rgba(255, 246, 205, 0.95)" };
    if (estado === "reenviado" || estado === "pendiente_rta") return { ...base, background: "rgba(255,255,255,.1)", color: "var(--text)" };
    return { ...base, background: "rgba(255,255,255,.08)", color: "var(--muted)" };
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
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
          <div style={{ display: "flex", alignItems: "center", gap: 16, position: "relative" }}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              style={{
                background: "rgba(255,255,255,.08)",
                border: "1px solid rgba(255,255,255,.16)",
                borderRadius: 8,
                padding: "8px 10px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                alignItems: "center",
                justifyContent: "center",
                minWidth: 40,
                minHeight: 40,
              }}
            >
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
            </button>
            {menuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 8,
                  background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))",
                  border: "1px solid rgba(255,255,255,.16)",
                  borderRadius: 12,
                  padding: "12px 0",
                  minWidth: 220,
                  boxShadow: "0 8px 24px rgba(0,0,0,.4)",
                  zIndex: 1000,
                }}
              >
                <Link href="/app/mediaciones" onClick={() => setMenuOpen(false)} style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkLeave}>⚖️ Mediaciones</Link>
                <Link href="/app/mediaciones/nueva" onClick={() => setMenuOpen(false)} style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkLeave}>➕ Nueva mediación</Link>
                <Link href="/app/mediaciones/lotes" onClick={() => setMenuOpen(false)} style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkLeave}>📦 Despacho por lotes</Link>
                <Link href="/superadmin" onClick={() => setMenuOpen(false)} style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkLeave}>🏠 Inicio</Link>
                <button onClick={() => { setMenuOpen(false); logout(); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 20px", color: "var(--brand-red)", background: "transparent", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", borderLeft: "3px solid transparent" }}>🚪 Salir</button>
              </div>
            )}
          </div>
          <img className="logoMini" src="/logo.png" alt="Logo" style={{ marginLeft: 12 }} />
          <h1>Mediaciones</h1>
          <div className="spacer" />
          {currentUserName && <span style={{ fontSize: 14, color: "var(--muted)", marginRight: 8 }}>{currentUserName}</span>}
          <Link className="btn primary" href="/app/mediaciones/nueva">Nueva</Link>
          <Link className="btn" href="/app/mediaciones/lotes">Despacho por lotes</Link>
          <NotificationBell />
        </header>

        <div className="page">
          {/* Contadores */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
            <span style={{ padding: "8px 14px", background: "rgba(255,255,255,.08)", borderRadius: 10, fontSize: 14 }}><strong>Total</strong> {total}</span>
            <span style={{ padding: "8px 14px", background: "rgba(255,255,255,.08)", borderRadius: 10, fontSize: 14 }}><strong>Pendientes</strong> {pendientes}</span>
            <span style={{ padding: "8px 14px", background: "rgba(241,196,15,.15)", borderRadius: 10, fontSize: 14 }}><strong>Devueltos</strong> {devueltos}</span>
            <span style={{ padding: "8px 14px", background: "rgba(255,255,255,.08)", borderRadius: 10, fontSize: 14 }}><strong>Reenviados</strong> {reenviados}</span>
            <span style={{ padding: "8px 14px", background: "rgba(96,141,186,.2)", borderRadius: 10, fontSize: 14 }}><strong>Aceptados</strong> {aceptados}</span>
            <span style={{ padding: "8px 14px", background: "rgba(52,152,219,.2)", borderRadius: 10, fontSize: 14 }}><strong>Enviados</strong> {enviados}</span>
          </div>

          {/* Filtros por estado (tabs) */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <button
              className="btn"
              onClick={() => setEstadoFilter("")}
              style={estadoFilter === "" ? { borderColor: "var(--brand-blue-2)", background: "rgba(96,141,186,.2)" } : {}}
            >
              Todos
            </button>
            {ESTADOS.map((e) => (
              <button
                key={e}
                className="btn"
                onClick={() => setEstadoFilter(e)}
                style={estadoFilter === e ? { borderColor: "var(--brand-blue-2)", background: "rgba(96,141,186,.2)" } : {}}
              >
                {e.replace(/_/g, " ")}
              </button>
            ))}
          </div>

          {/* Búsqueda */}
          <div style={{ marginBottom: 16 }}>
            <input
              className="input"
              type="text"
              placeholder="Buscar por nombre, ID, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 360 }}
            />
          </div>

          {msg && <div className="error">{msg}</div>}

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>N° Trámite</th>
                  <th>Requirente</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr
                    key={r.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => router.push(`/app/mediaciones/${r.id}`)}
                  >
                    <td><strong>{r.numero_tramite || "—"}</strong></td>
                    <td>
                      <div>{r.req_nombre || "—"}</div>
                      {(r.mediacion_requeridos || []).length > 0 && (
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {(r.mediacion_requeridos || []).map((req) => req.nombre).filter(Boolean).join(", ") || "—"}
                        </div>
                      )}
                    </td>
                    <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.objeto_reclamo || ""}>{r.objeto_reclamo || "—"}</td>
                    <td><span style={badgeStyle(r.estado)}>{r.estado.replace(/_/g, " ")}</span></td>
                    <td>{formatDate(r.created_at)}</td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">No hay mediaciones con los filtros aplicados.</td>
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
