"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type ReiteratorioRow = {
  id: string;
  ocr_exp_nro: string | null;
  ocr_caratula: string | null;
  ocr_destinatario: string | null;
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

export default function ReiteratoriosPage() {
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<ReiteratorioRow[]>([]);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [enProcesoId, setEnProcesoId] = useState<string | null>(null);

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
          "id, ocr_exp_nro, ocr_caratula, ocr_destinatario, juzgado, pjn_cargado_at"
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
    return rows
      .map((r) => ({ ...r, dias: r.pjn_cargado_at ? diasDesde(r.pjn_cargado_at) : 0 }))
      .filter((r) => r.dias >= 14)
      .sort((a, b) => b.dias - a.dias);
  }, [rows]);

  async function presentar(id: string) {
    setMsg("");
    setMsgOk(false);
    setEnProcesoId(id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
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
        <div className="nav">
          <img className="logoMini" src="/logo.png" alt="" />
          <h1>Oficios Reiteratorios</h1>
          <div className="spacer" />
        </div>

        <div className="page">
          <p className="helper">
            Oficios cargados en PJN hace 14 días o más sin respuesta del juzgado.
          </p>

          {msg && <div className={msgOk ? "success" : "error"}>{msg}</div>}

          <div className="tableWrap" style={{ marginTop: 14 }}>
            <table className="table" style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Expediente</th>
                  <th style={{ minWidth: 260 }}>Carátula</th>
                  <th style={{ minWidth: 220 }}>Destinatario</th>
                  <th style={{ minWidth: 220 }}>Juzgado</th>
                  <th style={{ width: 160 }}>Días sin respuesta</th>
                  <th style={{ width: 140 }}>Alerta</th>
                  <th style={{ width: 230 }}>Acción</th>
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
                    return (
                      <tr key={r.id}>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {r.ocr_exp_nro?.trim() || <span className="muted">—</span>}
                        </td>
                        <td style={{ fontWeight: 600 }}>
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
                          <button
                            type="button"
                            className="btn primary"
                            disabled={enProcesoId === r.id}
                            onClick={() => void presentar(r.id)}
                            style={{ fontSize: 13 }}
                          >
                            {enProcesoId === r.id
                              ? "Presentando…"
                              : "Presentar Reiteratorio"}
                          </button>
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
