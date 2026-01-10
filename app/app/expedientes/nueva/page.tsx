"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function todayDDMMAAAA(): string {
  // Retornar la fecha de hoy en formato DD/MM/AAAA
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}

function ddmmaaaaToISO(ddmmaaaa: string): string | null {
  // Convertir DD/MM/AAAA a ISO (YYYY-MM-DDTHH:mm:ss)
  if (!ddmmaaaa || ddmmaaaa.trim() === "") return null;
  
  const parts = ddmmaaaa.trim().split("/");
  if (parts.length !== 3) return null;
  
  const [day, month, year] = parts.map(p => parseInt(p, 10));
  
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return null;
  
  try {
    const date = new Date(year, month - 1, day);
    // Verificar que la fecha es válida (evita 31/02)
    if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
      return null;
    }
    return date.toISOString();
  } catch {
    return null;
  }
}

function formatDateInput(value: string): string {
  // Formatear el input mientras se escribe: solo números y barras
  // Permitir formato parcial como DD/MM o DD/MM/AA
  const cleaned = value.replace(/[^\d/]/g, "");
  
  // Limitar a 10 caracteres (DD/MM/AAAA)
  if (cleaned.length > 10) return cleaned.slice(0, 10);
  
  // Agregar barras automáticamente
  let formatted = cleaned.replace(/\//g, "");
  
  if (formatted.length > 2) {
    formatted = formatted.slice(0, 2) + "/" + formatted.slice(2);
  }
  if (formatted.length > 5) {
    formatted = formatted.slice(0, 5) + "/" + formatted.slice(5);
  }
  
  return formatted;
}

export default function NuevaExpedientePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");
  const [numeroExpediente, setNumeroExpediente] = useState("");
  const [fechaUltimaModificacion, setFechaUltimaModificacion] = useState(todayDDMMAAAA());
  const [observaciones, setObservaciones] = useState("");

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

      // Verificar que el usuario tenga el rol de admin_expedientes (intentar función RPC primero, si falla verificar directamente)
      let hasRole = false;
      const { data: rpcResult, error: rpcErr } = await supabase.rpc("is_admin_expedientes");
      
      if (rpcErr) {
        // Si la función RPC no existe o falla, verificar directamente en la tabla
        const { data: roleData, error: roleErr } = await supabase
          .from("user_roles")
          .select("is_admin_expedientes")
          .eq("user_id", uid)
          .maybeSingle();
        
        if (!roleErr && roleData) {
          hasRole = roleData.is_admin_expedientes === true;
        }
      } else {
        hasRole = rpcResult === true;
      }
      
      if (!hasRole) {
        window.location.href = "/app";
        return;
      }

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
    if (!numeroExpediente.trim()) {
      setMsg("Falta completar Número de Expediente.");
      return;
    }
    if (!fechaUltimaModificacion || fechaUltimaModificacion.trim() === "") {
      setMsg("Falta completar Fecha Última Modificación.");
      return;
    }

    // Convertir fecha del input (DD/MM/AAAA) a ISO
    const fechaISO = ddmmaaaaToISO(fechaUltimaModificacion);
    if (!fechaISO) {
      setMsg("La fecha ingresada no es válida. Use el formato DD/MM/AAAA.");
      return;
    }

    setSaving(true);
    try {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

      let insertData: any = {
        owner_user_id: uid,
        caratula: caratula.trim(),
        juzgado: juzgado.trim() || null,
        numero_expediente: numeroExpediente.trim(),
        fecha_ultima_modificacion: fechaISO,
        estado: "ABIERTO",
      };

      // Intentar incluir observaciones
      if (observaciones.trim()) {
        insertData.observaciones = observaciones.trim();
      } else {
        insertData.observaciones = null;
      }

      let { data: created, error: insErr } = await supabase
        .from("expedientes")
        .insert(insertData)
        .select("id")
        .single();

      // Si falla por columna observaciones inexistente, reintentar sin ella
      if (insErr && insErr.message?.includes("observaciones")) {
        delete insertData.observaciones;
        const { data: createdRetry, error: insErrRetry } = await supabase
          .from("expedientes")
          .insert(insertData)
          .select("id")
          .single();
        
        if (insErrRetry || !createdRetry?.id) {
          setMsg(insErrRetry?.message || "No se pudo crear el expediente.");
          return;
        }
        created = createdRetry;
        insErr = null;
      }

      if (insErr || !created?.id) {
        setMsg(insErr?.message || "No se pudo crear el expediente.");
        return;
      }

      window.location.href = "/app/expedientes";
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
        <div className="page">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Nueva carga</h1>
            <Link href="/app/expedientes" className="btn">
              Volver
            </Link>
          </div>

          {msg && <div className="error">{msg}</div>}

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <div className="field">
              <label className="label">Carátula (obligatorio)</label>
              <input
                className="input"
                type="text"
                placeholder="Ej: Pérez c/ Gómez s/ daños"
                value={caratula}
                onChange={(e) => setCaratula(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="field">
              <label className="label">Juzgado</label>
              <input
                className="input"
                type="text"
                placeholder="Opcional"
                value={juzgado}
                onChange={(e) => setJuzgado(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="field">
              <label className="label">Número de Expediente (obligatorio)</label>
              <input
                className="input"
                type="text"
                placeholder="Ej: 12345/2024"
                value={numeroExpediente}
                onChange={(e) => setNumeroExpediente(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="field">
              <label className="label">Fecha Última Modificación (obligatorio)</label>
              <input
                className="input"
                type="text"
                placeholder="DD/MM/AAAA"
                value={fechaUltimaModificacion}
                onChange={(e) => {
                  const formatted = formatDateInput(e.target.value);
                  setFechaUltimaModificacion(formatted);
                }}
                onBlur={(e) => {
                  // Validar formato completo al salir del campo
                  const value = e.target.value.trim();
                  if (value && value.length === 10) {
                    const iso = ddmmaaaaToISO(value);
                    if (!iso) {
                      setMsg("La fecha ingresada no es válida. Use el formato DD/MM/AAAA.");
                    } else {
                      setMsg("");
                    }
                  }
                }}
                disabled={saving}
                maxLength={10}
                style={{ fontVariantNumeric: "normal" }}
              />
            </div>

            <div className="field">
              <label className="label">Observaciones</label>
              <textarea
                className="input"
                placeholder="Observaciones opcionales..."
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                disabled={saving}
                rows={4}
                style={{
                  resize: "vertical",
                  minHeight: "80px",
                }}
              />
            </div>

            <div className="actions">
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
              <Link href="/app/expedientes" className="btn">
                Cancelar
              </Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
