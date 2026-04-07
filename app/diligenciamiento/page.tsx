"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import NotificationBell from "@/app/components/NotificationBell";

type CedulaDiligenciamiento = {
  id: string;
  caratula: string | null;
  juzgado: string | null;
  ocr_exp_nro: string | null;
  ocr_procesado_at: string | null;
  pdf_acredita_url: string | null;
  pjn_cargado_at: string | null;
};

const linkStyle: React.CSSProperties = {
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

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: "2px solid rgba(255,255,255,.22)",
        borderTopColor: "var(--brand-blue-2)",
        borderRadius: "50%",
        animation: "spin 0.75s linear infinite",
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    />
  );
}

export default function DiligenciamientoPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [msgSuccess, setMsgSuccess] = useState(false);
  const [cedulas, setCedulas] = useState<CedulaDiligenciamiento[]>([]);
  const [modalCargarPjn, setModalCargarPjn] = useState<CedulaDiligenciamiento | null>(null);
  const [cargandoPjnId, setCargandoPjnId] = useState<string | null>(null);
  const [modalPjnError, setModalPjnError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentUserName, setCurrentUserName] = useState("");
  const [isAdminMediaciones, setIsAdminMediaciones] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = () => setMenuOpen(false);
    setTimeout(() => document.addEventListener("click", handleClickOutside), 0);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }

      const uid = sess.session.user.id;
      const sessionName = (sess.session.user.user_metadata as { full_name?: string })?.full_name || sess.session.user.email || "";
      setCurrentUserName(sessionName);

      const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", uid).maybeSingle();
      if (profile) {
        const name = profile.full_name?.trim() || profile.email?.trim() || "";
        if (name) setCurrentUserName(name);
      }

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("is_admin_mediaciones")
        .eq("user_id", uid)
        .maybeSingle();
      setIsAdminMediaciones(roleData?.is_admin_mediaciones === true);

      const token = sess.session.access_token;
      const res = await fetch("/api/diligenciamiento", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setMsgSuccess(false);
          setMsg(json?.error || "No tienes acceso a esta sección.");
        } else {
          setMsgSuccess(false);
          setMsg(json?.error || "Error al cargar cédulas.");
        }
        setCedulas([]);
      } else {
        const json = await res.json();
        setCedulas(json.cedulas ?? []);
      }
      setLoading(false);
    })();
  }, []);

  function verPdf(item: CedulaDiligenciamiento) {
    supabase.auth.getSession().then(({ data }) => {
      const token = data?.session?.access_token;
      if (!token) return;
      const url = `/api/diligenciamiento/${item.id}/pdf?token=${encodeURIComponent(token)}`;
      window.open(url, "_blank");
    });
  }

  async function confirmarCargarPjn() {
    const item = modalCargarPjn;
    if (!item) return;

    setMsg("");
    setMsgSuccess(false);
    setModalPjnError(null);
    setCargandoPjnId(item.id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setModalPjnError("Sesión expirada");
        return;
      }

      const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID?.trim();
      if (extensionId && typeof window !== "undefined" && item.pdf_acredita_url) {
        const chromeApi = (window as unknown as { chrome?: { runtime?: { sendMessage: (...a: unknown[]) => void; lastError?: { message: string } } } }).chrome;
        const sendMessage = chromeApi?.runtime?.sendMessage;
        if (sendMessage) {
          const jurisdiccion = process.env.NEXT_PUBLIC_PJN_JURISDICCION?.trim() || "CIV";
          const callbackUrl = `${window.location.origin}/api/cedulas/${item.id}/confirmar-pjn`;

          const extensionHandled = await new Promise<boolean>((resolve) => {
            try {
              sendMessage(
                extensionId,
                {
                  action: "cargar",
                  payload: {
                    cedulaId: item.id,
                    expNro: item.ocr_exp_nro || "",
                    jurisdiccion,
                    pdfUrl: item.pdf_acredita_url,
                    callbackUrl,
                    authToken: token,
                  },
                },
                (response: { ok?: boolean } | undefined) => {
                  const lastErr = chromeApi?.runtime?.lastError;
                  if (lastErr?.message) {
                    console.warn("Extensión PJN no disponible:", lastErr.message);
                    resolve(false);
                    return;
                  }
                  if (response?.ok) {
                    setModalCargarPjn(null);
                    setMsgSuccess(true);
                    setMsg(
                      "Se abrió el portal PJN en una pestaña nueva. Cuando envíes el escrito con ENVIAR, se registrará la fecha en el sistema."
                    );
                    resolve(true);
                    return;
                  }
                  resolve(false);
                }
              );
            } catch {
              resolve(false);
            }
          });

          if (extensionHandled) return;
        }
      }

      const res = await fetch(`/api/cedulas/${item.id}/cargar-pjn`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        extensionMode?: boolean;
        cedulaId?: string;
        expNro?: string;
        jurisdiccion?: string;
        exp_numero?: string;
        exp_anio?: string;
        pdfUrl?: string;
        error?: string;
        pruebaSinEnvio?: boolean;
        pjn_cargado_at?: string;
      };

      if (!res.ok) {
        const errText = data?.error || "Error al cargar en PJN";
        setModalPjnError(errText);
        return;
      }

      // Si el backend devuelve extensionMode, usar la extensión Chrome
      if (data.extensionMode && data.ok) {
        const extId = process.env.NEXT_PUBLIC_EXTENSION_ID?.trim();
        const chromeApi = (window as unknown as { chrome?: { runtime?: { sendMessage: (...a: unknown[]) => void; lastError?: { message: string } } } }).chrome;
        const sendMessage = chromeApi?.runtime?.sendMessage;
        if (extId && sendMessage) {
          const callbackUrl = `${window.location.origin}/api/cedulas/${item.id}/confirmar-pjn`;
          sendMessage(
            extId,
            {
              action: "cargar",
              payload: {
                cedulaId: data.cedulaId,
                expNro: data.expNro,
                jurisdiccion: data.jurisdiccion,
                exp_numero: data.exp_numero,
                exp_anio: data.exp_anio,
                pdfUrl: data.pdfUrl,
                callbackUrl,
                authToken: token,
              },
            },
            () => {
              const lastErr = chromeApi?.runtime?.lastError;
              if (lastErr?.message) {
                console.warn("Extensión no disponible:", lastErr.message);
              }
            }
          );
          setModalCargarPjn(null);
          setMsgSuccess(true);
          setMsg("El portal PJN se abrió. Revisá la nueva pestaña y apretá ENVIAR.");
        } else {
          alert("Instalá la extensión PJN Cargador para continuar.");
        }
        return;
      }

      if (data.pruebaSinEnvio === true) {
        setModalPjnError(null);
        setModalCargarPjn(null);
        setMsgSuccess(true);
        setMsg(
          "Prueba OK: el flujo llegó hasta antes de enviar el escrito; no se presentó nada en PJN ni se guardó fecha en el sistema."
        );
        return;
      }

      const at =
        typeof data.pjn_cargado_at === "string"
          ? data.pjn_cargado_at
          : new Date().toISOString();

      setCedulas((prev) =>
        prev.map((c) => (c.id === item.id ? { ...c, pjn_cargado_at: at } : c))
      );
      setModalPjnError(null);
      setModalCargarPjn(null);
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : "Error al cargar en PJN";
      setModalPjnError(m);
    } finally {
      setCargandoPjnId(null);
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

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="container">
      <section className="card" style={{ overflow: "visible" }}>
        <header
          style={{
            background: "linear-gradient(135deg, rgba(0,82,156,.25), rgba(0,82,156,.08))",
            borderBottom: "1px solid rgba(255,255,255,.12)",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            position: "relative",
            overflow: "visible",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
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
                transition: "all 0.2s ease",
                minWidth: 40,
                minHeight: 40,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,.08)"; }}
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
                  left: 24,
                  marginTop: 8,
                  background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))",
                  border: "1px solid rgba(255,255,255,.16)",
                  borderRadius: 12,
                  padding: "12px 0",
                  minWidth: 220,
                  maxHeight: "min(80vh, 500px)",
                  overflowY: "auto",
                  boxShadow: "0 8px 24px rgba(0,0,0,.4)",
                  zIndex: 1000,
                  backdropFilter: "blur(10px)",
                }}
              >
                <Link href="/superadmin" onClick={() => setMenuOpen(false)} style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkLeave}>📊 Dashboard SuperAdmin</Link>
                <Link href="/superadmin/mis-juzgados" onClick={() => setMenuOpen(false)} style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkLeave}>📋 Mis Juzgados</Link>
                <Link href="/diligenciamiento" onClick={() => setMenuOpen(false)} style={{ ...linkStyle, borderLeftColor: "rgba(96,141,186,1)", background: "rgba(255,255,255,.05)" }} onMouseEnter={linkHover} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,.05)"; e.currentTarget.style.borderLeftColor = "rgba(96,141,186,1)"; }}>📄 Diligenciamiento</Link>
                <Link href="/app/expedientes/nueva" onClick={() => setMenuOpen(false)} style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkLeave}>➕ Carga Expedientes</Link>
                {isAdminMediaciones && <Link href="/app/mediaciones" onClick={() => setMenuOpen(false)} style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkLeave}>⚖️ Mediaciones</Link>}
                <Link href="/prueba-pericia" onClick={() => setMenuOpen(false)} style={linkStyle} onMouseEnter={linkHover} onMouseLeave={linkLeave}>📅 Turnos Pericias</Link>
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 20px",
                    color: "var(--brand-red)",
                    background: "transparent",
                    border: "none",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "background 0.2s ease",
                    borderLeft: "3px solid transparent",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(225, 57, 64, .15)"; e.currentTarget.style.borderLeftColor = "var(--brand-red)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderLeftColor = "transparent"; }}
                >
                  🚪 Salir
                </button>
              </div>
            )}

            <img className="logoMini" src="/logo.png" alt="Logo" style={{ marginRight: 12 }} />
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "0.2px" }}>Diligenciamiento</h1>
              <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "rgba(234,243,255,.65)", fontWeight: 400 }}>
                Cédulas con nota &quot;Acredita Diligenciamiento&quot; listas para cargar en PJN
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {currentUserName && (
              <div
                style={{
                  padding: "8px 14px",
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(255,255,255,.14)",
                  borderRadius: 999,
                  color: "rgba(234,243,255,.92)",
                  fontSize: 13,
                  fontWeight: 650,
                  letterSpacing: "0.01em",
                  maxWidth: 260,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  height: 40,
                }}
                title={currentUserName}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 0 2px rgba(74,222,128,.35)" }} />
                <span>{currentUserName}</span>
              </div>
            )}
            {currentUserName && <NotificationBell />}
          </div>
        </header>

        <div className="page">
          {msg && (
            <div className={msgSuccess ? "success" : "error"}>{msg}</div>
          )}

          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ width: 180 }}>Carátula</th>
                  <th style={{ width: 120 }}>Exp. Nro</th>
                  <th style={{ width: 220 }}>Juzgado</th>
                  <th style={{ width: 140 }}>Fecha procesado</th>
                  <th style={{ width: 220 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cedulas.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted" style={{ padding: 24, textAlign: "center" }}>
                      No hay cédulas listas para diligenciamiento.
                    </td>
                  </tr>
                ) : (
                  cedulas.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600 }}>
                        {item.caratula?.trim() || <span className="muted">Sin carátula</span>}
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>
                        {item.ocr_exp_nro?.trim() || <span className="muted">—</span>}
                      </td>
                      <td>{item.juzgado?.trim() || <span className="muted">—</span>}</td>
                      <td>{fmtDate(item.ocr_procesado_at)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="btn primary"
                            onClick={() => verPdf(item)}
                            style={{ fontSize: 12, padding: "6px 12px" }}
                          >
                            Ver PDF
                          </button>
                          {item.pjn_cargado_at ? (
                            <span
                              className="badge badge--verde"
                              style={{
                                fontSize: 11,
                                padding: "6px 12px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                maxWidth: 280,
                                whiteSpace: "normal",
                                lineHeight: 1.35,
                              }}
                              title={fmtDate(item.pjn_cargado_at)}
                            >
                              Enviado al PJN ✓ · {fmtDate(item.pjn_cargado_at)}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => {
                                setModalPjnError(null);
                                setModalCargarPjn(item);
                              }}
                              disabled={cargandoPjnId === item.id}
                              style={{
                                fontSize: 12,
                                padding: "6px 12px",
                                borderColor: "rgba(0,169,82,.45)",
                                background: "rgba(0,169,82,.14)",
                                color: "rgba(235,255,240,.95)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                opacity: cargandoPjnId === item.id ? 0.85 : 1,
                              }}
                            >
                              {cargandoPjnId === item.id ? (
                                <>
                                  <Spinner size={13} />
                                  Procesando…
                                </>
                              ) : (
                                "Cargar en PJN"
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Modal confirmar Cargar en PJN */}
      {modalCargarPjn && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={() => !cargandoPjnId && setModalCargarPjn(null)}
        >
          <div
            style={{
              background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))",
              border: "1px solid rgba(255,255,255,.2)",
              borderRadius: 16,
              padding: 24,
              maxWidth: 420,
              width: "90%",
              boxShadow: "0 12px 40px rgba(0,0,0,.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Cargar en PJN</h3>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
              Se enviará el PDF de acreditación al portal PJN de forma automática (puede tardar entre 30
              segundos y 2 minutos). No cierres esta ventana hasta que termine.
            </p>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
              Cédula: &quot;{modalCargarPjn.caratula?.trim() || "Sin carátula"}&quot;
            </p>
            {modalPjnError && (
              <div className="error" style={{ marginBottom: 14, fontSize: 13 }}>
                {modalPjnError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => confirmarCargarPjn()}
                disabled={!!cargandoPjnId}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                {cargandoPjnId ? (
                  <>
                    <Spinner size={14} />
                    Enviando a PJN…
                  </>
                ) : (
                  "Confirmar envío"
                )}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => !cargandoPjnId && setModalCargarPjn(null)}
                style={{
                  borderColor: "rgba(231,76,60,.5)",
                  background: "rgba(231,76,60,.2)",
                  color: "rgba(255,220,216,.95)",
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
