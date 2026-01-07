// app/app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { colorFromFechaCarga, daysSince, labelFromColor } from "@/lib/semaforo";

type CedulaRow = {
  id: string;
  caratula: string | null;
  juzgado: string | null;
  estado: string | null;
  pdf_path: string | null;
  fecha_carga: string | null;
};

function Badge({ color }: { color: "VERDE" | "AMARILLO" | "ROJO" }) {
  const cls =
    color === "ROJO"
      ? "badge rojo"
      : color === "AMARILLO"
      ? "badge amarillo"
      : "badge verde";

  return (
    <span className={cls}>
      <span className="dot" />
      {labelFromColor(color)}
    </span>
  );
}

export default function MisCedulasPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CedulaRow[]>([]);
  const [msg, setMsg] = useState("");

  async function requireSessionOrRedirect() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      window.location.href = "/login";
      return null;
    }
    return data.session;
  }

  async function load() {
    setMsg("");
    setLoading(true);
    try {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

      const { data, error } = await supabase
        .from("cedulas")
        .select("id, caratula, juzgado, estado, pdf_path, fecha_carga")
        .eq("owner_user_id", uid)
        .order("fecha_carga", { ascending: false });

      if (error) {
        setMsg(error.message);
        setRows([]);
        return;
      }

      setRows((data as CedulaRow[]) || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onLogout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function openPdf(path: string) {
    const { data, error } = await supabase.storage.from("cedulas").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      setMsg(error?.message || "No se pudo generar el link para abrir la cédula.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function uploadPdfForCedula(cedulaId: string, file: File) {
    setMsg("");

    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) {
      window.location.href = "/login";
      return;
    }

    const path = `${uid}/${cedulaId}.pdf`;

    const { error: upErr } = await supabase.storage.from("cedulas").upload(path, file, {
      upsert: true,
      contentType: "application/pdf",
    });

    if (upErr) {
      setMsg("No se pudo subir el archivo: " + upErr.message);
      return;
    }

    const { error: dbErr } = await supabase.from("cedulas").update({ pdf_path: path }).eq("id", cedulaId);
    if (dbErr) {
      setMsg("Archivo subido, pero no se pudo guardar el link en la base: " + dbErr.message);
      return;
    }

    await load();
  }

  const viewRows = useMemo(() => {
    return rows.map((r) => {
      const color = colorFromFechaCarga(r.fecha_carga);
      const dias = daysSince(r.fecha_carga);
      const carga = r.fecha_carga ? r.fecha_carga.slice(0, 10) : "";
      return { ...r, _color: color, _dias: dias, _carga: carga };
    });
  }, [rows]);

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <img className="logoMini" src="/logo.png" alt="Logo" />
          <h1>Mis cédulas</h1>
          <div className="spacer" />
          <Link className="btn primary" href="/app/nueva">
            Nueva
          </Link>
          <button className="btn danger" onClick={onLogout}>
            Salir
          </button>
        </header>

        <div className="page">
          {msg && <div className="error">{msg}</div>}

          <div className="helper" style={{ marginBottom: 10 }}>
            Semáforo automático por antigüedad desde la carga:{" "}
            <b>Verde 0–29</b> · <b>Amarillo 30–59</b> · <b>Rojo 60+</b> días.
          </div>

          {loading ? (
            <p className="helper">Cargando…</p>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Semáforo</th>
                    <th>Carátula</th>
                    <th>Juzgado</th>
                    <th>Carga</th>
                    <th>Días</th>
                    <th>Estado</th>
                    <th>Cédula</th>
                  </tr>
                </thead>
                <tbody>
                  {viewRows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Badge color={r._color} />
                      </td>
                      <td>{r.caratula || ""}</td>
                      <td>{r.juzgado || ""}</td>
                      <td>{r._carga}</td>
                      <td>{r._dias}</td>
                      <td>{r.estado || ""}</td>
                      <td>
                        {r.pdf_path ? (
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button className="btn" onClick={() => openPdf(r.pdf_path!)}>
                              Abrir
                            </button>

                            <label className="btn primary" style={{ cursor: "pointer" }}>
                              Reemplazar
                              <input
                                type="file"
                                accept="application/pdf"
                                style={{ display: "none" }}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) uploadPdfForCedula(r.id, f);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <span className="helper">Sin archivo</span>
                            <label className="btn primary" style={{ cursor: "pointer" }}>
                              Cargar
                              <input
                                type="file"
                                accept="application/pdf"
                                style={{ display: "none" }}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) uploadPdfForCedula(r.id, f);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {viewRows.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <p className="helper">No hay cédulas cargadas.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
