"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function isoToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDDMMAA(iso?: string | null): string {
  if (!iso) return "";
  // Maneja formatos ISO: YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss+00:00
  // Extraer solo la parte de la fecha (primeros 10 caracteres: YYYY-MM-DD)
  const datePart = iso.substring(0, 10);
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y.slice(2)}`;
}

export default function NuevaCedulaPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");

  const [file, setFile] = useState<File | null>(null);

  // Se setea AL SUBIR ARCHIVO, no editable
  const [fechaCargaISO, setFechaCargaISO] = useState<string>("");

  const vencISO = useMemo(() => {
    if (!fechaCargaISO) return "";
    return addDaysISO(fechaCargaISO, 30);
  }, [fechaCargaISO]);

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
    setMsg("");
    setFile(f);

    if (!f) {
      setFechaCargaISO("");
      return;
    }

    // al subir archivo: setear fecha de carga (hoy)
    setFechaCargaISO(isoToday());

    // Tipos permitidos: PDF, DOC, DOCX (por nombre o mime)
    const name = (f.name || "").toLowerCase();
    const ok =
      name.endsWith(".pdf") || name.endsWith(".docx") || name.endsWith(".doc");

    if (!ok) {
      setMsg("Formato inválido. Tipos permitidos: PDF, DOC, DOCX.");
      setFile(null);
      setFechaCargaISO("");
      return;
    }

    // Autorrelleno para archivos DOCX
    if (name.endsWith(".docx")) {
      try {
        // Extraer carátula
        const formDataCaratula = new FormData();
        formDataCaratula.append("file", f);
        const caratulaRes = await fetch("/api/extract-caratula", {
          method: "POST",
          body: formDataCaratula,
        });
        if (caratulaRes.ok) {
          const caratulaData = await caratulaRes.json();
          if (caratulaData.caratula) {
            setCaratula(caratulaData.caratula);
          }
        }

        // Extraer juzgado
        const formDataJuzgado = new FormData();
        formDataJuzgado.append("file", f);
        const juzgadoRes = await fetch("/api/extract-juzgado", {
          method: "POST",
          body: formDataJuzgado,
        });
        if (juzgadoRes.ok) {
          const juzgadoData = await juzgadoRes.json();
          if (juzgadoData.juzgado) {
            setJuzgado(juzgadoData.juzgado);
          }
        }
      } catch (err) {
        // Si falla el parseo, no es crítico - el usuario puede completar manualmente
        // Error silencioso: el usuario puede completar los campos manualmente
      }
    }
  }

  async function onSave() {
    setMsg("");

    if (!file) {
      setMsg("La cédula es obligatoria. Por favor cargá el archivo.");
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

    setSaving(true);
    try {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

      // 1) Crear cédula (fecha_carga y vencimiento automático)
      const { data: created, error: insErr } = await supabase
        .from("cedulas")
        .insert({
          owner_user_id: uid,
          caratula: caratula.trim(),
          juzgado: juzgado.trim() || null,
          fecha_carga: fechaCargaISO,                 // ✅ guarda fecha de carga
          fecha_vencimiento: vencISO || null,         // ✅ guarda vencimiento (carga + 30)
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

      // 2) Subir archivo
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `${uid}/${cedulaId}.${ext}`;

      const contentType =
        ext === "pdf"
          ? "application/pdf"
          : ext === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : ext === "doc"
          ? "application/msword"
          : "application/octet-stream";

      const { error: upErr } = await supabase.storage
        .from("cedulas")
        .upload(path, file, { upsert: true, contentType });

      if (upErr) {
        setMsg("La cédula se creó, pero el archivo no se pudo subir: " + upErr.message);
        window.location.href = "/app";
        return;
      }

      // 3) Guardar path
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
          <h1>Nueva cédula</h1>
          <div className="spacer" />
          <Link className="btn" href="/app">
            Volver
          </Link>
        </header>

        <div className="page">
          <p className="helper">
            El sistema toma automáticamente la <b>Fecha de Carga</b> al subir el archivo y calcula un{" "}
            <b>vencimiento automático</b> a 30 días.
            <br />
            {fechaCargaISO ? (
              <>
                Fecha de Carga: <b>{fmtDDMMAA(fechaCargaISO)}</b> — Vencimiento automático:{" "}
                <b>{fmtDDMMAA(vencISO)}</b>
              </>
            ) : null}
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
                placeholder="Opcional"
              />
            </div>

            <div>
              <label className="label">Fecha de Carga (auto)</label>
              <input
                className="input"
                value={fechaCargaISO ? fmtDDMMAA(fechaCargaISO) : ""}
                disabled
                style={{ opacity: 0.8, cursor: "not-allowed" }}
                placeholder="Se completa al subir el archivo"
              />
            </div>

            <div>
              <label className="label">CÉDULA (obligatorio)</label>

              {/* Botón custom coherente: mantenemos input real (oculto) */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label className="btn primary" style={{ cursor: "pointer" }}>
                  Cargar archivo
                  <input
                    type="file"
                    style={{ display: "none" }}
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
