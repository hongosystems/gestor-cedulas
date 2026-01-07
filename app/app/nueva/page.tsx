"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function isoToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDDMMAA(iso: string): string {
  if (!iso) return "";
  // iso = YYYY-MM-DD
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y.slice(-2)}`;
}

function fileExt(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".doc")) return "doc";
  return "";
}

function contentTypeForExt(ext: string): string {
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "doc") return "application/msword";
  return "application/octet-stream";
}

export default function NuevaCedulaPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [msg, setMsg] = useState("");

  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");

  // Fecha de Carga auto (ISO), no editable
  const [fechaCargaISO, setFechaCargaISO] = useState("");
  // Vencimiento auto = carga + 30
  const vencISO = useMemo(() => (fechaCargaISO ? addDaysISO(fechaCargaISO, 30) : ""), [fechaCargaISO]);

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
  }, []);

  async function onFileChange(f: File | null) {
    setFile(f);
    setMsg("");

    if (!f) return;

    const ext = fileExt(f.name);
    if (!["pdf", "docx", "doc"].includes(ext)) {
      setMsg("Formato inválido. Tipos permitidos: PDF, DOC, DOCX.");
      return;
    }

    // ✅ Fecha de carga se setea automáticamente al subir archivo
    const carga = isoToday();
    setFechaCargaISO(carga);

    // DOC viejo: no lo parseamos (sin conversión)
    if (ext === "doc") {
      setMsg("DOC detectado. Podés completar Carátula y Juzgado manualmente (sin autocompletar).");
      return;
    }

    // PDF o DOCX: autocompletar
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", f);

      // 1) Carátula
      const resC = await fetch("/api/extract-caratula", { method: "POST", body: fd });
      const jsonC = await resC.json().catch(() => ({}));
      if (resC.ok && jsonC?.caratula) {
        setCaratula(String(jsonC.caratula));
      }

      // 2) Juzgado (nuevo FormData para evitar edge cases de stream en algunos runtimes)
      const fd2 = new FormData();
      fd2.append("file", f);
      const resJ = await fetch("/api/extract-juzgado", { method: "POST", body: fd2 });
      const jsonJ = await resJ.json().catch(() => ({}));
      if (resJ.ok && jsonJ?.juzgado) {
        setJuzgado(String(jsonJ.juzgado));
      }

      // Mensaje suave si no encontró nada
      const noCar = !(jsonC?.caratula);
      const noJuz = !(jsonJ?.juzgado);
      if (noCar && noJuz) {
        setMsg("No se pudo leer el archivo para autocompletar Carátula/Juzgado. Podés completarlos a mano.");
      }
    } catch {
      setMsg("No se pudo leer el archivo para autocompletar.");
    } finally {
      setParsing(false);
    }
  }

  async function onSave() {
    setMsg("");

    // ✅ PDF/DOC/DOCX es obligatorio (no opcional)
    if (!file) {
      setMsg("Tenés que cargar el archivo (PDF/DOC/DOCX).");
      return;
    }

    // Carga auto se define al seleccionar archivo
    if (!fechaCargaISO) {
      setMsg("No se pudo determinar la Fecha de Carga. Volvé a cargar el archivo.");
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

      // 1) Crear cédula
      const { data: created, error: insErr } = await supabase
        .from("cedulas")
        .insert({
          owner_user_id: uid,
          caratula: caratula.trim(),
          juzgado: juzgado.trim() || null,
          fecha_carga: fechaCargaISO,
          fecha_vencimiento: vencISO, // ✅ siempre seteado (NOT NULL)
          estado: "NUEVA",
          pdf_path: null,
        })
        .select("id")
        .single();

      if (insErr || !created?.id) {
        setMsg(insErr?.message || "No se pudo crear la cédula.");
        return;
      }

      const cedulaId = created.id as string;

      // 2) Subir archivo
      const ext = fileExt(file.name) || "bin";
      const path = `${uid}/${cedulaId}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("cedulas")
        .upload(path, file, {
          upsert: true,
          contentType: contentTypeForExt(ext),
        });

      if (upErr) {
        setMsg("La cédula se creó, pero el archivo no se pudo subir: " + upErr.message);
        window.location.href = "/app";
        return;
      }

      // 3) Guardar link del archivo (mantenemos pdf_path por compatibilidad, aunque sea DOCX)
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
            El sistema toma automáticamente la <b>Fecha de Carga</b> al subir el archivo y calcula un <b>vencimiento automático</b> a 30 días.
            <br />
            Fecha de Carga: <b>{fechaCargaISO ? formatDDMMAA(fechaCargaISO) : "—"}</b> — Vencimiento automático: <b>{fechaCargaISO ? formatDDMMAA(vencISO) : "—"}</b>
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
              <p className="helper" style={{ marginTop: 6 }}>
                Si subís un DOCX o PDF, se autocompleta buscando: <i>Expediente caratulado: “…”</i>
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
              <p className="helper" style={{ marginTop: 6 }}>
                En PDF/DOCX se autocompleta tomando el texto entre <b>TRIBUNAL</b> y <b>-</b>.
              </p>
            </div>

            <div>
              <label className="label">Fecha de Carga (auto)</label>
              <input className="input" value={fechaCargaISO ? formatDDMMAA(fechaCargaISO) : ""} disabled />
            </div>

            <div>
              <label className="label">CÉDULA (obligatorio)</label>

              {/* Botón estético para subir archivo */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label className="btn" style={{ cursor: "pointer" }}>
                  Cargar archivo
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    style={{ display: "none" }}
                    onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                  />
                </label>
                <span className="helper" style={{ margin: 0 }}>
                  {file ? file.name : "Ningún archivo seleccionado"}
                </span>
              </div>

              <p className="helper" style={{ marginTop: 6 }}>
                Tipos permitidos: PDF, DOC, DOCX.
              </p>

              {parsing && (
                <p className="helper" style={{ marginTop: 6 }}>
                  Leyendo archivo para autocompletar…
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn primary" disabled={saving || parsing} onClick={onSave}>
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
