"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Razon = {
  patron: string;
  /** null indica una razón "meta" (ej: extracción fallida), sin peso en scoring. */
  clasificacion: "CEDULA" | "OFICIO" | null;
  peso: number;
  pagina: number | null;
};

type AuditRow = {
  id: string;
  cedula_id: string;
  tipo_documento_actual: string | null;
  tipo_documento_actual_cedulas: string | null;
  clasificacion_pdf: "CEDULA" | "OFICIO" | "INDETERMINADO";
  confianza: number | null;
  razones: Razon[] | null;
  archivo_origen: string | null;
  aplicado: boolean;
  created_at: string;
  caratula: string | null;
  juzgado: string | null;
  ocr_exp_nro: string | null;
  pdf_path: string | null;
  estado_ocr: string | null;
  pjn_cargado_at: string | null;
  mismatch: boolean;
};

type PreviewBreakdown = {
  total: number;
  con_pdf: number;
  sin_pdf: number;
  por_tipo_actual: {
    CEDULA: number;
    OFICIO: number;
    NULL: number;
    OTROS: number;
  };
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function tipoBadge(tipo: string | null | undefined) {
  const t = (tipo || "").toUpperCase();
  if (t === "OFICIO") return { label: "OFICIO", bg: "rgba(168,85,247,.18)", border: "rgba(168,85,247,.45)", color: "rgba(243,232,255,.96)" };
  if (t === "CEDULA") return { label: "CEDULA", bg: "rgba(59,130,246,.18)", border: "rgba(59,130,246,.45)", color: "rgba(219,234,254,.96)" };
  if (t === "INDETERMINADO") return { label: "INDETERMINADO", bg: "rgba(234,179,8,.18)", border: "rgba(234,179,8,.45)", color: "rgba(254,243,199,.96)" };
  return { label: tipo ? String(tipo) : "—", bg: "rgba(255,255,255,.06)", border: "rgba(255,255,255,.18)", color: "rgba(234,243,255,.85)" };
}

export default function AuditoriaTipoDocumentoPage() {
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [preview, setPreview] = useState<PreviewBreakdown | null>(null);
  const [onlyMismatches, setOnlyMismatches] = useState(false);
  const [revisados, setRevisados] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string>("");
  const [msgOk, setMsgOk] = useState(false);

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

      const token = sess.session.access_token;

      const [previewRes, listRes] = await Promise.all([
        fetch("/api/admin/auditoria-tipo-documento-pdf/preview", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/admin/auditoria-tipo-documento-pdf/list", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (previewRes.ok) {
        const previewJson = await previewRes.json();
        setPreview({
          total: previewJson.total ?? 0,
          con_pdf: previewJson.con_pdf ?? 0,
          sin_pdf: previewJson.sin_pdf ?? 0,
          por_tipo_actual: previewJson.por_tipo_actual ?? {
            CEDULA: 0,
            OFICIO: 0,
            NULL: 0,
            OTROS: 0,
          },
        });
      }

      if (listRes.ok) {
        const listJson = await listRes.json();
        setRows((listJson.rows ?? []) as AuditRow[]);
      } else {
        const errJson = await listRes.json().catch(() => ({} as { error?: string }));
        setMsgOk(false);
        setMsg(errJson?.error || "Error al cargar la auditoría");
      }

      setLoading(false);
    })();
  }, []);

  const filteredRows = useMemo(() => {
    if (!onlyMismatches) return rows;
    return rows.filter((r) => r.mismatch);
  }, [rows, onlyMismatches]);

  function verPdf(cedulaId: string) {
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) return;
      const url = `/api/admin/auditoria-tipo-documento-pdf/${cedulaId}/pdf?token=${encodeURIComponent(token)}`;
      window.open(url, "_blank");
    });
  }

  function toggleRevisado(id: string) {
    setRevisados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              Auditoría de tipo de documento (PDF)
            </h1>
            <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "rgba(234,243,255,.65)" }}>
              Comparación entre cedulas.tipo_documento y el contenido del PDF. Solo lectura.
              No modifica datos.
            </p>
          </div>
        </header>

        <div className="page">
          {msg && (
            <div className={msgOk ? "success" : "error"} style={{ marginBottom: 12 }}>
              {msg}
            </div>
          )}

          {/* Resumen del universo */}
          {preview && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <StatBox label="Total cédulas" value={preview.total} />
              <StatBox label="Con PDF" value={preview.con_pdf} />
              <StatBox label="Sin PDF" value={preview.sin_pdf} />
              <StatBox label="tipo=CEDULA" value={preview.por_tipo_actual.CEDULA} />
              <StatBox label="tipo=OFICIO" value={preview.por_tipo_actual.OFICIO} />
              <StatBox label="tipo=NULL" value={preview.por_tipo_actual.NULL} />
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={onlyMismatches}
                onChange={(e) => setOnlyMismatches(e.target.checked)}
              />
              Mostrar solo inconsistencias
            </label>
            <span className="muted" style={{ fontSize: 12 }}>
              {filteredRows.length} registro(s) auditado(s)
            </span>
            <span
              className="muted"
              style={{ fontSize: 11, marginLeft: "auto", maxWidth: 520, lineHeight: 1.5 }}
            >
              Para auditar nuevas cédulas: <code>POST /api/admin/auditoria-tipo-documento-pdf/run</code> con
              <code> dry_run=false</code>.
            </span>
          </div>

          <div className="tableWrap">
            <table className="table" style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Tipo actual</th>
                  <th style={{ width: 150 }}>Tipo detectado</th>
                  <th style={{ width: 90 }}>Confianza</th>
                  <th style={{ minWidth: 220 }}>Carátula</th>
                  <th style={{ width: 120 }}>Exp. Nro</th>
                  <th style={{ minWidth: 180 }}>Juzgado</th>
                  <th style={{ minWidth: 260 }}>Razones</th>
                  <th style={{ width: 130 }}>Auditado</th>
                  <th style={{ width: 220 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="muted" style={{ padding: 24, textAlign: "center" }}>
                      No hay registros auditados todavía.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => {
                    const tipoActualBadge = tipoBadge(
                      r.tipo_documento_actual_cedulas ?? r.tipo_documento_actual
                    );
                    const detectadoBadge = tipoBadge(r.clasificacion_pdf);
                    const revisado = revisados.has(r.id);
                    return (
                      <tr key={r.id} style={{ opacity: revisado ? 0.55 : 1 }}>
                        <td>
                          <Badge {...tipoActualBadge} />
                        </td>
                        <td>
                          <Badge {...detectadoBadge} />
                          {r.mismatch && (
                            <div
                              style={{
                                fontSize: 10,
                                color: "rgba(252,165,165,.95)",
                                marginTop: 4,
                                fontWeight: 700,
                                letterSpacing: 0.3,
                              }}
                            >
                              ⚠ INCONSISTENCIA
                            </div>
                          )}
                        </td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {r.confianza != null ? r.confianza.toFixed(2) : "—"}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {r.caratula?.trim() || <span className="muted">—</span>}
                        </td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {r.ocr_exp_nro?.trim() || <span className="muted">—</span>}
                        </td>
                        <td>{r.juzgado?.trim() || <span className="muted">—</span>}</td>
                        <td>
                          {r.razones && r.razones.length > 0 ? (
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 4,
                                maxWidth: 360,
                              }}
                            >
                              {r.razones.slice(0, 8).map((rz, i) => {
                                const isMeta = rz.clasificacion == null;
                                const bg = isMeta
                                  ? "rgba(234,179,8,.16)"
                                  : rz.clasificacion === "OFICIO"
                                    ? "rgba(168,85,247,.18)"
                                    : "rgba(59,130,246,.18)";
                                const border = isMeta
                                  ? "1px solid rgba(234,179,8,.4)"
                                  : rz.clasificacion === "OFICIO"
                                    ? "1px solid rgba(168,85,247,.4)"
                                    : "1px solid rgba(59,130,246,.4)";
                                const titulo = isMeta
                                  ? "nota (no contribuye al scoring)"
                                  : `peso ${rz.peso}${rz.pagina ? ` · pág ${rz.pagina}` : ""}`;
                                return (
                                  <span
                                    key={`${r.id}-${i}`}
                                    title={titulo}
                                    style={{
                                      fontSize: 10,
                                      padding: "2px 6px",
                                      borderRadius: 4,
                                      background: bg,
                                      border,
                                      color: "rgba(234,243,255,.92)",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {rz.patron}
                                  </span>
                                );
                              })}
                              {r.razones.length > 8 && (
                                <span className="muted" style={{ fontSize: 10 }}>
                                  +{r.razones.length - 8}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td style={{ fontSize: 11, color: "rgba(234,243,255,.7)" }}>
                          {fmtDate(r.created_at)}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="btn primary"
                              onClick={() => verPdf(r.cedula_id)}
                              style={{ fontSize: 12, padding: "5px 10px" }}
                            >
                              Ver PDF
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => toggleRevisado(r.id)}
                              style={{
                                fontSize: 12,
                                padding: "5px 10px",
                                borderColor: revisado ? "rgba(46,204,113,.5)" : undefined,
                                background: revisado ? "rgba(46,204,113,.18)" : undefined,
                              }}
                            >
                              {revisado ? "✓ Revisado" : "Marcar revisado"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="muted" style={{ marginTop: 16, fontSize: 11, lineHeight: 1.6, maxWidth: 720 }}>
            La aplicación de correcciones automáticas (UPDATE en <code>cedulas.tipo_documento</code>)
            queda fuera de esta fase. Hasta que se implemente la fase 7 (apply), esta pantalla es
            estrictamente de revisión. El estado &quot;Revisado&quot; es local al navegador y no se
            persiste en la base.
          </p>
        </div>
      </section>
    </main>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.12)",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(234,243,255,.65)", fontWeight: 600, letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function Badge({
  label,
  bg,
  border,
  color,
}: {
  label: string;
  bg: string;
  border: string;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 9px",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.3,
      }}
    >
      {label}
    </span>
  );
}
