"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function NuevaCedulaPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");
  const [fechaNotif, setFechaNotif] = useState(""); // YYYY-MM-DD
  const [file, setFile] = useState<File | null>(null);

  const vencimientoAuto = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const v = new Date(base);
    v.setDate(v.getDate() + 30);
    return toISODate(v);
  }, []);

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
  }, []);

  async function onSave() {
    setMsg("");

    if (!caratula.trim()) {
      setMsg("Falta completar Carátula.");
      return;
    }

    if (!file) {
      setMsg("Por favor cargá la CÉDULA desde acá (Nueva).");
      return;
    }

    // Permitimos PDF y DOC/DOCX (como pediste después)
    const name = file.name.toLowerCase();
    const ok =
      name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx");
    if (!ok) {
      setMsg("El archivo debe ser PDF, DOC o DOCX.");
      return;
    }

    setSaving(true);
    try {
      const session = await requireSessionOrRedirect();
      if (!session) return;
      const uid = session.user.id;

      // 1) Crear cédula (NO pedimos vencimiento; DB lo calcula igual por trigger)
      // Igual mandamos fecha_vencimiento como referencia consistente con UI (30 días).
      const fechaCargaISO = new Date().toISOString();

      const { data: created, error: insErr } = await supabase
        .from("cedulas")
        .insert({
          owner_user_id: uid,
          caratula: caratula.trim(),
          juzgado: juzgado.trim() || null,
          fecha_notificacion: fechaNotif || null,
          fecha_carga: fechaCargaISO,
          fecha_vencimiento: vencimientoAuto, // compatible con la DB + trigger
          estado: "NUEVA",
          pdf_path: null,
        })
        .select("id")
        .single();

      if (insErr || !created?.id) {
        setMsg(insErr?.message || "No se pudo crear la cédula.");
        return;
      }

      const cedulaId = created.id;

      // 2) Subir archivo a Storage (seguimos usando bucket "cedulas" aunque no sea PDF)
      const ext = name.endsWith(".pdf") ? "pdf" : name.endsWith(".docx") ? "docx" : "doc";
      const path = `${uid}/${cedulaId}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("cedulas")
        .upload(path, file, {
          upsert: true,
          contentType: file.type || "application/octet-stream",
        });

      if (upErr) {
        setMsg("La cédula se creó, pero el archivo no se pudo subir: " + upErr.message);
        window.location.href = "/app";
        return;
      }

      // 3) Guardar el path del archivo en la DB
      const { error: dbErr } = await supabase
        .from("cedulas")
        .update({ pdf_path: path })
        .eq("id", cedulaId);

      if (dbErr) {
        setMsg("Archivo subido, pero no se pudo guardar el link en la base: " + dbErr.message);
        window.location.href = "/app";
        return;
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
          <Link className="btn" href="/app">Volver</Link>
        </header>

        <div className="page">
          <p className="helper">
            El sistema toma automáticamente la <b>fecha de carga</b> y calcula un <b>vencimiento automático</b> a 30 días.
          </p>

          <div className="pill" style={{ marginBottom: 12 }}>
            Vencimiento automático: <b>{vencimientoAuto}</b>
          </div>

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
                placeholder="Opcional"
              />
            </div>

            <div>
              <label className="label">Fecha notificación</label>
              <input
                className="input"
                type="date"
                value={fechaNotif}
                onChange={(e) => setFechaNotif(e.target.value)}
              />
            </div>

            <div>
              <label className="label">CÉDULA</label>

              {/* Input real escondido */}
              <input
                id="cedulaFile"
                type="file"
                style={{ display: "none" }}
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label className="btn" htmlFor="cedulaFile" style={{ cursor: "pointer" }}>
                  Cargar archivo
                </label>
                <span className="helper" style={{ margin: 0 }}>
                  {file ? file.name : "Ningún archivo seleccionado"}
                </span>
              </div>

              <p className="helper" style={{ marginTop: 6 }}>
                Tipos permitidos: PDF, DOC, DOCX.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn primary" disabled={saving} onClick={onSave}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
              <Link className="btn" href="/app">Cancelar</Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
