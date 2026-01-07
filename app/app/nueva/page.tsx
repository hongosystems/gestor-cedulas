"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function isoToDDMMAA(iso: string) {
  // iso: YYYY-MM-DD -> DD/MM/AA
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const yy = m[1].slice(2);
  return `${m[3]}/${m[2]}/${yy}`;
}

async function requireSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login";
    return null;
  }
  return data.session;
}

export default function NuevaCedulaPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);

  const [msg, setMsg] = useState("");

  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");

  // Fecha de Carga: se setea automáticamente al subir el archivo
  const [fechaCargaISO, setFechaCargaISO] = useState<string>(""); // YYYY-MM-DD
  const vencimientoISO = useMemo(() => {
    return fechaCargaISO ? addDaysISO(fechaCargaISO, 30) : "";
  }, [fechaCargaISO]);

  const [file, setFile] = useState<File | null>(null);

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

  async function onFileChange(f: File | null) {
    setMsg("");
    setFile(f);

    if (!f) {
      setFechaCargaISO("");
      return;
    }

    const name = (f.name || "").toLowerCase();
    const isPdf = name.endsWith(".pdf") || f.type === "application/pdf";
    const isDocx = name.endsWith(".docx");
    const isDoc = name.endsWith(".doc");

    if (!isPdf && !isDocx && !isDoc) {
      setMsg("El archivo debe ser PDF, DOC o DOCX.");
      setFechaCargaISO("");
      setFile(null);
      return;
    }

    // ✅ Fecha de Carga se autocompleta al subir el archivo
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setFechaCargaISO(toISODate(today));

    // ✅ Autocompletar solo si es DOCX
    if (!isDocx) return;

    setParsing(true);
    try {
      // 1) Carátula
      const fd1 = new FormData();
      fd1.append("file", f);
      const r1 = await fetch("/api/extract-caratula", { method: "POST", body: fd1 });
      const j1 = await r1.json().catch(() => ({}));
      if (r1.ok && j1?.caratula) {
        setCaratula(String(j1.caratula));
      }

      // 2) Juzgado
      const fd2 = new FormData();
      fd2.append("file", f);
      const r2 = await fetch("/api/extract-juzgado", { method: "POST", body: fd2 });
      const j2 = await r2.json().catch(() => ({}));
      if (r2.ok && j2?.juzgado) {
        setJuzgado(String(j2.juzgado));
      }

      // Mensaje suave si no pudo completar algo
      const noCaratula = r1.ok && !j1?.caratula;
      const noJuzgado = r2.ok && !j2?.juzgado;
      if (noCaratula && noJuzgado) {
        setMsg("No se pudo leer el DOCX para autocompletar Carátula/Juzgado. Podés completarlos a mano.");
      } else if (noCaratula) {
        setMsg("No se pudo autocompletar Carátula desde el DOCX. Podés completarla a mano.");
      } else if (noJuzgado) {
        setMsg("No se pudo autocompletar Juzgado desde el DOCX. Podés completarlo a mano.");
      }
    } catch {
      setMsg("No se pudo leer el DOCX para autocompletar datos.");
    } finally {
      setParsing(false);
    }
  }

  async function onSave() {
    setMsg("");

    if (!file) {
      setMsg("La cédula es obligatoria. Cargá el archivo para continuar.");
      return;
    }

    if (!fechaCargaISO) {
      setMsg("No se pudo determinar la Fecha de Carga. Volvé a cargar el archivo.");
      return;
    }

    if (!caratula.trim()) {
      setMsg("Falta completar Carátula.");
      return;
    }

    // vencimiento automático: 30 días
    if (!vencimientoISO) {
      setMsg("No se pudo calcular el vencimiento automático.");
      return;
    }

    setSaving(true);
    try {
      const session = await requireSessionOrRedirect();
      if (!session) return;
      const uid = session.user.id;

      // 1) Crear cédula (sin pedir vencimiento al usuario)
      const { data: created, error: insErr } = await supabase
        .from("cedulas")
        .insert({
          owner_user_id: uid,
          caratula: caratula.trim(),
          juzgado: juzgado.trim() || null,
          fecha_notificacion: fechaCargaISO, // reutilizamos esta columna como "Fecha de Carga"
          fecha_vencimiento: vencimientoISO,
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

      // 2) Subir archivo a storage (mismo bucket)
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const safeExt = ext === "docx" || ext === "doc" || ext === "pdf" ? ext : "bin";
      const path = `${uid}/${cedulaId}.${safeExt}`;

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

      // 3) Guardar link
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

  const fileLabel = file ? file.name : "Ningún archivo seleccionado";

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
            El sistema toma automáticamente la <b>Fecha de Carga</b> al subir el archivo y calcula un{" "}
            <b>vencimiento automático a 30 días</b>.
          </p>

          {fechaCargaISO && (
            <p className="helper" style={{ marginTop: 6 }}>
              Fecha de Carga: <b>{isoToDDMMAA(fechaCargaISO)}</b> — Vencimiento automático:{" "}
              <b>{isoToDDMMAA(vencimientoISO)}</b>
            </p>
          )}

          {msg && <div className="error">{msg}</div>}

          <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
            <div>
              <label className="label">Carátula</label>
              <input
                className="input"
                value={caratula}
                onChange={(e) => setCaratula(e.target.value)}
                placeholder='Ej: Pérez c/ Gómez s/ daños'
              />
              <p className="helper" style={{ marginTop: 6 }}>
                Si subís un DOCX, se autocompleta buscando: <i>Expediente caratulado: “…”</i>
              </p>
            </div>

            <div>
              <label className="label">Juzgado</label>
              <input
                className="input"
                value={juzgado}
                onChange={(e) => setJuzgado(e.target.value)}
                placeholder='Opcional (se intenta autocompletar desde DOCX)'
              />
              <p className="helper" style={{ marginTop: 6 }}>
                En DOCX se autocompleta tomando el texto entre <b>TRIBUNAL</b> y <b>-</b>.
              </p>
            </div>

            <div>
              <label className="label">Fecha de Carga (auto)</label>
              <input
                className="input"
                value={fechaCargaISO ? isoToDDMMAA(fechaCargaISO) : ""}
                readOnly
                disabled
                placeholder="DD/MM/AA"
              />
              <p className="helper" style={{ marginTop: 6 }}>
                Se completa automáticamente al subir el archivo. No es editable.
              </p>
            </div>

            <div>
              <label className="label">CÉDULA (obligatorio)</label>

              {/* input oculto para que el botón diga "Cargar archivo" */}
              <input
                id="cedula-file"
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: "none" }}
                onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              />

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label
                  htmlFor="cedula-file"
                  className="btn"
                  style={{ cursor: parsing || saving ? "not-allowed" : "pointer", opacity: parsing || saving ? 0.7 : 1 }}
                >
                  Cargar archivo
                </label>
                <span className="helper">{fileLabel}</span>
              </div>

              <p className="helper" style={{ marginTop: 6 }}>
                Tipos permitidos: PDF, DOC, DOCX. (El autorrelleno funciona con DOCX.)
              </p>

              {parsing && (
                <p className="helper" style={{ marginTop: 6 }}>
                  Leyendo DOCX para autocompletar…
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn primary" disabled={saving || parsing} onClick={onSave}>
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
