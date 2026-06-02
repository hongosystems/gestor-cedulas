"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { usePageSearchBridge } from "@/app/hooks/usePageSearchBridge";

type ReiteratorioRow = {
  id: string;
  ocr_exp_nro: string | null;
  ocr_caratula: string | null;
  ocr_destinatario: string | null;
  caratula: string | null;
  juzgado: string | null;
  pjn_cargado_at: string;
};

function diasDesde(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  const diffMs = Date.now() - then;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function datosFaltantes(row: ReiteratorioRow): string[] {
  const faltan: string[] = [];
  if (!row.ocr_exp_nro?.trim()) faltan.push("expediente");
  if (!row.ocr_caratula?.trim() && !row.caratula?.trim()) faltan.push("carátula");
  if (!row.ocr_destinatario?.trim()) faltan.push("destinatario");
  return faltan;
}

async function getFreshAccessToken(): Promise<string | null> {
  const { data: current } = await supabase.auth.getSession();
  if (!current.session) return null;

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (!error && refreshed.session?.access_token) {
    return refreshed.session.access_token;
  }

  return current.session.access_token;
}

export default function ReiteratoriosPage() {
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<ReiteratorioRow[]>([]);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [enProcesoId, setEnProcesoId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [buscarTexto, setBuscarTexto] = useState("");
  usePageSearchBridge(buscarTexto, setBuscarTexto);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }
      const uid = sess.session.user.id;

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("is_superadmin")
        .eq("user_id", uid)
        .maybeSingle();

      const isSuperadmin = roleData?.is_superadmin === true;
      setAllowed(isSuperadmin);
      setAuthChecked(true);

      if (!isSuperadmin) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("cedulas")
        .select(
          "id, ocr_exp_nro, ocr_caratula, ocr_destinatario, caratula, juzgado, pjn_cargado_at"
        )
        .eq("tipo_documento", "OFICIO")
        .eq("estado_ocr", "listo")
        .not("pjn_cargado_at", "is", null)
        .order("pjn_cargado_at", { ascending: true });

      if (error) {
        setMsg(error.message);
        setMsgOk(false);
      } else {
        setRows((data ?? []) as ReiteratorioRow[]);
      }
      setLoading(false);
    })();
  }, []);

  const filas = useMemo(() => {
    let list = rows
      .map((r) => ({ ...r, dias: r.pjn_cargado_at ? diasDesde(r.pjn_cargado_at) : 0 }))
      .filter((r) => r.dias >= 14);
    const q = buscarTexto.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const hay = [r.ocr_exp_nro, r.ocr_caratula, r.caratula, r.ocr_destinatario, r.juzgado]
          .map((x) => (x || "").toLowerCase())
          .join(" ");
        return hay.includes(q);
      });
    }
    return list.sort((a, b) => b.dias - a.dias);
  }, [rows, buscarTexto]);

  async function presentar(id: string) {
    setMsg("");
    setMsgOk(false);
    setEnProcesoId(id);
    try {
      const token = await getFreshAccessToken();
      if (!token) {
        setMsg("Sesión expirada");
        return;
      }

      const res = await fetch(`/api/reiteratorios/${id}/presentar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok || data.ok !== true) {
        setMsg(data.error || "No se pudo presentar el reiteratorio");
        setMsgOk(false);
        return;
      }

      setRows((prev) => prev.filter((r) => r.id !== id));
      setMsg("Reiteratorio presentado correctamente.");
      setMsgOk(true);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "Error inesperado";
      setMsg(m);
      setMsgOk(false);
    } finally {
      setEnProcesoId(null);
    }
  }

  async function verPdf(id: string) {
    setMsg("");
    setMsgOk(false);
    setPreviewId(id);
    try {
      const token = await getFreshAccessToken();
      if (!token) {
        setMsg("Sesión expirada");
        return;
      }

      const res = await fetch(`/api/reiteratorios/${id}/presentar`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ soloPreview: true }),
      });

      if (!res.ok) {
        let errMsg = `No se pudo generar la vista previa (${res.status})`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) errMsg = data.error;
        } catch {
          // respuesta no JSON: dejamos el mensaje genérico
        }
        setMsg(errMsg);
        setMsgOk(false);
        return;
      }

      const blob = await res.blob();
      window.open(URL.createObjectURL(blob));
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "Error inesperado";
      setMsg(m);
      setMsgOk(false);
    } finally {
      setPreviewId(null);
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

  if (authChecked && !allowed) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <div className="error">
              Acceso restringido. Solo superadmin puede ver esta sección.
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card" style={{ overflow: "visible" }}>
        <header className="page-header">
          <div className="page-header__main">
            <div>
              <h1 className="page-header__title">Oficios Reiteratorios</h1>
              <p className="page-header__subtitle">
                Oficios cargados en PJN hace 14 días o más sin respuesta del juzgado.
              </p>
            </div>
          </div>
        </header>

        <div className="page">
          {msg && <div className={msgOk ? "success" : "error"}>{msg}</div>}

          <div className="tableWrap data-table-shell" style={{ marginTop: 14, ["--table-min-width" as string]: "1100px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Expediente</th>
                  <th style={{ minWidth: 260 }}>Carátula</th>
                  <th style={{ minWidth: 220 }}>Destinatario</th>
                  <th style={{ minWidth: 220 }}>Juzgado</th>
                  <th style={{ width: 160 }}>Días sin respuesta</th>
                  <th style={{ width: 140 }}>Alerta</th>
                  <th style={{ width: 330 }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="muted"
                      style={{ padding: 24, textAlign: "center" }}
                    >
                      No hay oficios con 14 días o más sin respuesta.
                    </td>
                  </tr>
                ) : (
                  filas.map((r) => {
                    const alertaClass =
                      r.dias >= 21 ? "badge badge--rojo" : "badge badge--amarillo";
                    const alertaLabel = r.dias >= 21 ? "3 semanas" : "2 semanas";
                    const faltan = datosFaltantes(r);
                    const puedeGenerarPdf = faltan.length === 0;
                    return (
                      <tr key={r.id}>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {r.ocr_exp_nro?.trim() || <span className="muted">—</span>}
                        </td>
                        <td className="col-caratula">
                          {r.ocr_caratula?.trim() || (
                            <span className="muted">Sin carátula</span>
                          )}
                        </td>
                        <td>
                          {r.ocr_destinatario?.trim() || (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{r.juzgado?.trim() || <span className="muted">—</span>}</td>
                        <td
                          style={{
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 700,
                          }}
                        >
                          {r.dias}
                        </td>
                        <td>
                          <span className={alertaClass}>
                            <span className="badgeDot" />
                            {alertaLabel}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="btn"
                                disabled={!puedeGenerarPdf || previewId === r.id || enProcesoId === r.id}
                                onClick={() => void verPdf(r.id)}
                                style={{ fontSize: 13 }}
                                title={!puedeGenerarPdf ? "Faltan datos del OCR para generar el PDF" : undefined}
                              >
                                {previewId === r.id ? "Generando…" : "Ver PDF"}
                              </button>
                              <button
                                type="button"
                                className="btn primary"
                                disabled={!puedeGenerarPdf || enProcesoId === r.id || previewId === r.id}
                                onClick={() => void presentar(r.id)}
                                style={{ fontSize: 13 }}
                                title={!puedeGenerarPdf ? "Faltan datos del OCR para presentar el reiteratorio" : undefined}
                              >
                                {enProcesoId === r.id
                                  ? "Presentando…"
                                  : "Presentar Reiteratorio"}
                              </button>
                            </div>
                            {!puedeGenerarPdf && (
                              <span className="muted" style={{ fontSize: 11 }}>
                                Faltan datos OCR: {faltan.join(", ")}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
