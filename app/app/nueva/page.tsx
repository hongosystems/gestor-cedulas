"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDDMMYY(d: Date) {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function isoYYYYMMDD(d: Date) {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function getExt(name: string) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function inferContentType(file: File) {
  if (file.type) return file.type;
  const ext = getExt(file.name);
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "doc") return "application/msword";
  return "application/octet-stream";
}

function isDocx(file: File) {
  const ext = getExt(file.name);
  return (
    ext === "docx" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function isAllowed(file: File) {
  const ext = getExt(file.name);
  if (ext === "pdf" || ext === "doc" || ext === "docx") return true;
  // algunos navegadores mandan type vacío; por eso validamos por ext
  const t = (file.type || "").toLowerCase();
  if (t === "application/pdf") return true;
  if (t === "application/msword") return true;
  if (
    t ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return true;
  return false;
}

export default function NuevaCedulaPage() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [msg, setMsg] = useState("");

  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");

  // Fecha de carga (auto) y vencimiento auto
  const [fechaCarga, setFechaCarga] = useState<Date | null>(null);
  const vencimientoAuto = useMemo(() => {
    if (!fechaCarga) return null;
    return addDays(fechaCarga, 30);
  }, [fechaCarga]);

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

  async function onPickFile(f: File | null) {
    setMsg("");
    setFile(f);

    if (!f) return;

    if (!isAllowed(f)) {
      setMsg("Archivo no permitido. Subí PDF / DOC / DOCX.");
      setFile(null);
      return;
    }

    // Autocompleta Fecha de Carga al subir archivo (no editable)
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    setFechaCarga(now);

    // Si es DOCX: autocompletar carátula vía API
    if (isDocx(f)) {
      setParsing(true);
      try {
        const fd = new FormData();
        fd.append("file", f);

        const res = await fetch("/api/extract-caratula", {
          method: "POST",
          body: fd,
        });

        const json = await res.json().catch(() => ({} as any));

        if (!res.ok) {
          setMsg(json?.error || "No se pudo leer el DOCX para autocompletar Carátula.");
          return;
        }

        const extracted = String(json?.caratula || "").trim();
        if (extracted) {
          setCaratula(extracted);
        } else {
          setMsg(
            "No pude detectar la Carátula automáticamente en el DOCX. Podés completarla a mano."
          );
        }
      } catch {
        setMsg("No se pudo leer el DOCX para autocompletar Carátula.");
      } finally {
        setParsing(false);
      }
    }
  }

  async function onSave() {
    setMsg("");

    if (!file) {
      setMsg("Tenés que cargar la CÉDULA (archivo) para continuar.");
      return;
    }
    if (!fechaCarga) {
      setMsg("No se pudo determinar la Fecha de Carga. Volvé a elegir el archivo.");
      return;
    }
    if (!vencimientoAuto) {
      setMsg("No se pudo calcular el vencimiento automático.");
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

      // 1) Crear cédula con vencimiento auto (30 días) y fecha de carga (columna existente)
      const { data: created, error: insErr } = await supabase
        .from("cedulas")
        .insert({
          owner_user_id: uid,
          caratula: caratula.trim(),
          juzgado: juzgado.trim() || null,

          // 👇 En tu DB se llama fecha_notificacion pero ahora la usamos como Fecha de Carga
          fecha_notificacion: isoYYYYMMDD(fechaCarga),

          // 👇 Vencimiento automático (no editable por empleados)
          fecha_vencimiento: isoYYYYMMDD(vencimientoAuto),

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

      // 2) Subir archivo (PDF/DOC/DOCX) al bucket "cedulas"
      const ext = getExt(file.name) || "bin";
      const path = `${uid}/${cedulaId}.${ext}`;

      const { error: upErr } = await supabase.storage.from("cedulas").upload(path, file, {
        upsert: true,
        contentType: inferContentType(file),
      });

      if (upErr) {
        setMsg("La cédula se creó, pero el archivo no se pudo subir: " + upErr.message);
        window.location.href = "/app";
        return;
      }

      // 3) Guardar link del archivo en DB
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
          <Link className="btn" href="/app">
            Volver
          </Link>
        </header>

        <div className="page">
          <p className="helper">
            La carga de <b>CÉDULA</b> (archivo) es obligatoria. Si es <b>DOCX</b>, intentamos
            autocompletar <b>Carátula</b>.
          </p>

          {msg && <div className="error">{msg}</div>}

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label className="label">CÉDULA (PDF / DOC / DOCX) — obligatorio</label>

              {/* input real oculto */}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: "none" }}
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />

              {/* botón custom */}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={saving || parsing}
                >
                  Cargar archivo
                </button>
                <span className="helper" style={{ margin: 0 }}>
                  {file ? file.name : "Ningún archivo seleccionado"}
                </span>
                {parsing && (
                  <span className="helper" style={{ margin: 0 }}>
                    Leyendo DOCX para detectar Carátula…
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="label">Fecha de carga (automática)</label>
              <input
                className="input"
                value={fechaCarga ? formatDDMMYY(fechaCarga) : ""}
                placeholder="Se completa al cargar el archivo"
                disabled
                style={{ opacity: 0.75 }}
              />
            </div>

            <div>
              <label className="label">Vencimiento (automático: +30 días)</label>
              <input
                className="input"
                value={vencimientoAuto ? formatDDMMYY(vencimientoAuto) : ""}
                placeholder="Se calcula automáticamente"
                disabled
                style={{ opacity: 0.75 }}
              />
              <p className="helper" style={{ marginTop: 6 }}>
                Regla pedida por el cliente: 30 días → empieza a “amarillo”; 60 días → “rojo”.
              </p>
            </div>

            <div>
              <label className="label">Carátula</label>
              <input
                className="input"
                value={caratula}
                onChange={(e) => setCaratula(e.target.value)}
                placeholder='Ej: "FUENTES, NAHUEL MATIAS C/ ..."'
              />
              <p className="helper" style={{ marginTop: 6 }}>
                Si el archivo es DOCX, intentamos autocompletar. Podés corregirla.
              </p>
            </div>

            <div>
              <label className="label">Juzgado</label>
              <input
                className="input"
                value={juzgado}
                onChange={(e) => setJuzgado(e.target.value)}
                placeholder="(opcional por ahora)"
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn primary"
                disabled={saving || parsing}
                onClick={onSave}
              >
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
