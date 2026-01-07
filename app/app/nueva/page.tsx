// app/app/nueva/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function NuevaCedulaPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");
  const [fechaNotif, setFechaNotif] = useState(""); // YYYY-MM-DD
  const [file, setFile] = useState<File | null>(null);

  async function requireSessionOrRedirect() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      window.location.href = "/login";
      return null;
    }
    return data.session;
  }

  useEffect(() => {
    (async () => {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;
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

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave() {
    setMsg("");

    if (!caratula.trim()) {
      setMsg("Falta completar Carátula.");
      return;
    }

    if (file && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setMsg("El archivo debe ser un PDF.");
      return;
    }

    setSaving(true);
    try {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

      // 1) Insert con fecha_carga automática (NOW)
      const nowIso = new Date().toISOString();

      const { data: created, error: insErr } = await supabase
        .from("cedulas")
        .insert({
          owner_user_id: uid,
          caratula: caratula.trim(),
          juzgado: juzgado.trim() || null,
          fecha_notificacion: fechaNotif || null,
          estado: "NUEVA",
          pdf_path: null,
          fecha_carga: nowIso,
        })
        .select("id")
        .single();

      if (insErr || !created?.id) {
        setMsg(insErr?.message || "No se pudo crear la cédula.");
        return;
      }

      const cedulaId = created.id as string;

      // 2) Subir PDF si lo cargó
      if (file) {
        const path = `${uid}/${cedulaId}.pdf`;

        const { error: upErr } = await supabase.storage.from("cedulas").upload(path, file, {
          upsert: true,
          contentType: "application/pdf",
        });

        if (upErr) {
          setMsg("La cédula se creó, pero el archivo no se pudo subir: " + upErr.message);
          window.location.href = "/app";
          return;
        }

        const { error: dbErr } = await supabase.from("cedulas").update({ pdf_path: path }).eq("id", cedulaId);
        if (dbErr) {
          setMsg("Archivo subido, pero no se pudo guardar el link en la base: " + dbErr.message);
          window.location.href = "/app";
          return;
        }
      }

      window.location.href = "/app";
    } finally {
      setSaving(false);
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
          <h1>Nueva cédula</h1>
          <div className="spacer" />
          <Link className="btn" href="/app">
            Volver
          </Link>
        </header>

        <div className="page">
          <p className="helper">
            La <b>fecha de carga</b> se guarda automáticamente y el semáforo se calcula por antigüedad:
            <b> Verde 0–29</b> · <b>Amarillo 30–59</b> · <b>Rojo 60+</b> días.
          </p>

          {msg && <div className="error">{msg}</div>}

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label className="label">Carátula</label>
              <input
                className="input"
                value={caratula}
                onChange={(e) => setCaratula(e.target.value)}
                placeholder="Ej: Pérez c/ Gómez s/ daños"
              />
            </div>

            <div>
              <label className="label">Juzgado</label>
              <input
                className="input"
                value={juzgado}
                onChange={(e) => setJuzgado(e.target.value)}
                placeholder="Ej: Juzgado Civil y Comercial N° 3"
              />
            </div>

            <div>
              <label className="label">Fecha notificación (opcional)</label>
              <input className="input" type="date" value={fechaNotif} onChange={(e) => setFechaNotif(e.target.value)} />
            </div>

            <div>
              <label className="label">Cédula (PDF) (opcional)</label>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label className="btn primary" style={{ cursor: "pointer" }}>
                  Cargar archivo
                  <input
                    type="file"
                    accept="application/pdf"
                    style={{ display: "none" }}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                <span className="helper">
                  {file ? file.name : "Sin archivo seleccionado"}
                </span>
              </div>

              <p className="helper" style={{ marginTop: 6 }}>
                Si te lo olvidás, después podés cargarlo desde la lista (Cargar / Reemplazar).
              </p>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn primary" disabled={saving} onClick={onSave}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
              <Link className="btn" href="/app">
                Cancelar
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
