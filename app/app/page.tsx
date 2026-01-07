"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_notificacion: string | null; // usamos como "Fecha de Carga"
  pdf_path: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoToDDMMAA(iso: string) {
  // YYYY-MM-DD -> DD/MM/AA
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const yy = m[1].slice(2);
  return `${m[3]}/${m[2]}/${yy}`;
}

function daysSinceISO(iso: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000));
}

type Semaforo = "VERDE" | "AMARILLO" | "ROJO";

function semaforoByAge(diasDesdeCarga: number): Semaforo {
  if (diasDesdeCarga >= 60) return "ROJO";
  if (diasDesdeCarga >= 30) return "AMARILLO";
  return "VERDE";
}

function SemaforoChip({ value }: { value: Semaforo }) {
  const style: React.CSSProperties =
    value === "VERDE"
      ? {
          background: "rgba(46, 204, 113, 0.16)",
          border: "1px solid rgba(46, 204, 113, 0.35)",
          color: "rgba(210, 255, 226, 0.95)",
        }
      : value === "AMARILLO"
      ? {
          background: "rgba(241, 196, 15, 0.14)",
          border: "1px solid rgba(241, 196, 15, 0.35)",
          color: "rgba(255, 246, 205, 0.95)",
        }
      : {
          background: "rgba(231, 76, 60, 0.14)",
          border: "1px solid rgba(231, 76, 60, 0.35)",
          color: "rgba(255, 220, 216, 0.95)",
        };

  return (
    <span
      style={{
        ...style,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 12px",
        borderRadius: 999,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: 0.4,
        minWidth: 88,
      }}
    >
      {value}
    </span>
  );
}

async function requireSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login";
    return null;
  }
  return data.session;
}

export default function MisCedulasPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [cedulas, setCedulas] = useState<Cedula[]>([]);

  useEffect(() => {
    (async () => {
      setMsg("");

      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

      // must_change_password guard
      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", uid)
        .single();

      if (pErr) {
        window.location.href = "/login";
        return;
      }
      if (prof?.must_change_password) {
        window.location.href = "/cambiar-password";
        return;
      }

      // listar cédulas del usuario
      const { data: cs, error: cErr } = await supabase
        .from("cedulas")
        .select("id, owner_user_id, caratula, juzgado, fecha_notificacion, pdf_path")
        .eq("owner_user_id", uid)
        .order("fecha_notificacion", { ascending: false });

      if (cErr) {
        setMsg(cErr.message);
        setLoading(false);
        return;
      }

      setCedulas((cs ?? []) as Cedula[]);
      setLoading(false);
    })();
  }, []);

  const rows = useMemo(() => {
    return cedulas.map((c) => {
      const cargaISO = c.fecha_notificacion || "";
      const dias = cargaISO ? daysSinceISO(cargaISO) : null;
      const sem = dias === null ? ("VERDE" as Semaforo) : semaforoByAge(dias);
      return { ...c, cargaISO, dias, sem };
    });
  }, [cedulas]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function abrirArchivo(path: string) {
    setMsg("");
    try {
      const { data, error } = await supabase.storage.from("cedulas").createSignedUrl(path, 60);
      if (error || !data?.signedUrl) {
        setMsg(error?.message || "No se pudo generar el link para abrir el archivo.");
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setMsg("No se pudo abrir el archivo.");
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
          <img className="logoMini" src="/logo.png" alt="Logo" />
          <h1>Mis Cédulas/Oficios</h1>
          <div className="spacer" />
          <Link className="btn primary" href="/app/nueva">
            Nueva
          </Link>
          <button className="btn danger" onClick={logout}>
            Salir
          </button>
        </header>

        <div className="page">
          <p className="helper" style={{ marginBottom: 12 }}>
            Semáforo automático por antigüedad desde la carga: <b>Verde</b> 0–29 · <b>Amarillo</b> 30–59 ·{" "}
            <b>Rojo</b> 60+ días.
          </p>

          {msg && <div className="error">{msg}</div>}

          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Semáforo</th>
                  <th>Carátula</th>
                  <th>Juzgado</th>
                  <th style={{ width: 150 }}>Fecha de Carga</th>
                  <th style={{ width: 80, textAlign: "right" }}>Días</th>
                  <th style={{ width: 170, textAlign: "right" }}>Cédula/Oficio</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} style={{ verticalAlign: "top" }}>
                    <td>
                      <SemaforoChip value={c.sem} />
                    </td>

                    <td style={{ fontWeight: 650 }}>
                      {c.caratula?.trim() ? c.caratula : <span className="muted">Sin carátula</span>}
                    </td>

                    <td>{c.juzgado?.trim() ? c.juzgado : <span className="muted">—</span>}</td>

                    <td>{c.cargaISO ? isoToDDMMAA(c.cargaISO) : <span className="muted">—</span>}</td>

                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {typeof c.dias === "number" ? c.dias : <span className="muted">—</span>}
                    </td>

                    <td style={{ textAlign: "right" }}>
                      {c.pdf_path ? (
                        <button className="btn primary" onClick={() => abrirArchivo(c.pdf_path!)}>
                          Abrir
                        </button>
                      ) : (
                        <span className="muted">Sin archivo</span>
                      )}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Todavía no cargaste cédulas/oficios.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="helper" style={{ marginTop: 10 }}>
            Nota: “Abrir” genera un link temporal (seguro) al archivo.
          </p>
        </div>
      </section>
    </main>
  );
}
