// app/app/nueva/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function isoToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  dt.setHours(0, 0, 0, 0);
  return dt.toISOString().slice(0, 10);
}

function formatDMY(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const yy = (y || "").slice(2, 4);
  return `${d}/${m}/${yy}`;
}

function extFromName(name: string) {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".doc")) return "doc";
  return "bin";
}

export default function NuevaCedulaPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");

  // Fecha de Carga (auto al subir archivo)
  const [fechaCargaISO, setFechaCargaISO] = useState<string>("");
  const fechaCargaDMY = useMemo(() => formatDMY(fechaCargaISO), [fechaCargaISO]);

  // Vencimiento automático: +30 días
  const vencISO = useMemo(() => (fechaCargaISO ? addDaysISO(fechaCargaISO, 30) : ""), [fechaCargaISO]);
  const vencDMY = useMemo(() => formatDMY(vencISO), [vencISO]);

  const [file, setFile] = useState<File | null>(null);
  const [parsingDocx, setParsingDocx] = useState(false);

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

  async function onFilePicked(f: File | null) {
    setMsg("");
    setFile(f);

    if (!f) {
      setFechaCargaISO("");
      return;
    }

    // Archivo obligatorio, tipos permitidos
    const name = (f.name || "").toLowerCase();
    const ok =
      f.type === "application/pdf" ||
      f.type === "application/msword" ||
      f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.endsWith(".pdf") ||
      name.endsWith(".doc") ||
      name.endsWith(".docx");

    if (!ok) {
      setMsg("Tipos permitidos: PDF, DOC, DOCX.");
      setFile(null);
      setFechaCargaISO("");
      return;
    }

    // Fecha de Carga se setea automáticamente al subir archivo
    setFechaCargaISO(isoToday());

    // Autocompletar CARÁTULA SOLO si es DOCX
    const isDocx =
      f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.endsWith(".docx");

    if (!isDocx) return;

    setParsingDocx(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/extract-caratula", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMsg(json?.error || "No se pudo leer el DOCX para autocompletar Carátula.");
        return;
      }

      if (json?.caratula) {
        setCaratula(String(json.caratula));
      } else {
        setMsg('No encontré "Expediente caratulado: “...”" en el DOCX. Completá Carátula a mano.');
      }
    } catch {
      setMsg("No se pudo leer el DOCX para autocompletar Carátula.");
    } finally {
      setParsingDocx(false);
    }
  }

  async function onSave() {
    setMsg("");

    if (!file) {
      setMsg("Cargar archivo no es opcional. Subí la cédula (PDF/DOC/DOCX).");
      return;
    }
    if (!fechaCargaISO) {
      setMsg("No se pudo determinar la Fecha de Carga. Volvé a seleccionar el archivo.");
      return;
    }
    if (!caratula.trim()) {
      setMsg("Falta completar Carátula.");
      return;
    }

    setSaving(true);
    try {
      const session = await requireSessionOrRedirect();
      if (!session) return;
      const uid = session.user.id;

      // 1) Insert DB (vencimiento automático +30)
      // Nota: uso columnas existentes: fecha_notificacion como "fecha de carga"
      const { data: created, error: insErr } = await supabase
        .from("cedulas")
        .insert({
          owner_user_id: uid,
          caratula: caratula.trim(),
          juzgado: (juzgado || "").trim() || null,
          fecha_notificacion: fechaCargaISO,     // <- ahora es "Fecha de Carga"
          fecha_vencimiento: vencISO,            // <- automático a 30 días
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

      // 2) Subir archivo a Storage (mantenemos pdf_path por compatibilidad)
      const ext = extFromName(file.name);
      const path = `${uid}/${cedulaId}.${ext}`;

      const { error: upErr } = await supabase.storage.from("cedulas").upload(path, file, {
        upsert: true,
        contentType: file.type || "application/octet-stream",
      });

      if (upErr) {
        setMsg("La cédula se creó, pero el archivo no se pudo subir: " + upErr.message);
        window.location.href = "/app";
        return;
      }

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
            El sistema toma automáticamente la <b>Fecha de Carga</b> al subir el archivo y calcula un{" "}
            <b>vencimiento automático a 30 días</b>.
            <br />
            {fechaCargaISO ? (
              <>
                Fecha de Carga: <b>{fechaCargaDMY}</b> — Vencimiento automático: <b>{vencDMY}</b>
              </>
            ) : (
              <>Subí el archivo para calcular fechas.</>
            )}
          </p>

          {msg && <div className="error">{msg}</div>}

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label className="label">Carátula</label>
              <input
                className="input"
                value={caratula}
                onChange={(e) => setCaratula(e.target.value)}
                placeholder='Ej: Pérez c/ Gómez s/ daños'
              />
              <p className="helper" style={{ marginTop: 6 }}>
                Si subís un <b>DOCX</b>, se autocompleta buscando: <i>Expediente caratulado: “...”</i>
              </p>
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
              <label className="label">Fecha de Carga (auto)</label>
              <input
                className="input"
                value={fechaCargaDMY || ""}
                placeholder="DD/MM/AA"
                disabled
                style={{ opacity: 0.75 }}
              />
            </div>

            <div>
              <label className="label">CÉDULA (obligatorio)</label>

              {/* Input oculto para cambiar el texto del botón */}
              <input
                id="cedulaFile"
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: "none" }}
                onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
              />

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label className="btn" htmlFor="cedulaFile">
                  Cargar archivo
                </label>
                <span className="helper" style={{ margin: 0 }}>
                  {file ? file.name : "Ningún archivo seleccionado"}
                </span>
              </div>

              <p className="helper" style={{ marginTop: 6 }}>
                Tipos permitidos: PDF, DOC, DOCX.
                {parsingDocx ? " Leyendo DOCX para autocompletar Carátula…" : ""}
              </p>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn primary" disabled={saving || parsingDocx} onClick={onSave}>
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
