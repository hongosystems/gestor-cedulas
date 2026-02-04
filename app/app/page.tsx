"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { daysSince } from "@/lib/semaforo";

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_carga: string | null;
  pdf_path: string | null;
  tipo_documento: "CEDULA" | "OFICIO" | null;
};

type DocumentType = "CEDULA" | "OFICIO" | null;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoToDDMMAA(iso: string) {
  // Maneja formatos ISO: YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss+00:00
  if (!iso || iso.trim() === "") return "";
  
  // Extraer solo la parte de la fecha (primeros 10 caracteres: YYYY-MM-DD)
  const datePart = iso.substring(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  
  const yy = m[1].slice(2);
  return `${m[3]}/${m[2]}/${yy}`;
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

type SortField = "dias" | "semaforo" | "fecha_carga" | "juzgado" | null;
type SortDirection = "asc" | "desc";

export default function MisCedulasPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [cedulas, setCedulas] = useState<Cedula[]>([]);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [semaforoFilter, setSemaforoFilter] = useState<Semaforo | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>("");

  useEffect(() => {
    (async () => {
      setMsg("");

      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;
      
      // Obtener nombre del usuario desde la sesión o user_metadata
      const sessionFullName = (session.user.user_metadata as { full_name?: string })?.full_name;
      const sessionEmail = (session.user.email || "").trim();
      const baseName = (sessionFullName || "").trim() || sessionEmail;
      setCurrentUserName(baseName);
      
      // Intentar mejorar el nombre desde profiles
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", uid)
        .maybeSingle();
      
      if (profile) {
        const profileName = profile.full_name?.trim() || profile.email?.trim() || "";
        if (profileName) {
          setCurrentUserName(profileName);
        }
      }

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

      // Verificar si es admin_expedientes - usar consulta directa para evitar errores 400
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_admin_expedientes")
        .eq("user_id", uid)
        .maybeSingle();
      
      const isAdminExp = !roleErr && roleData?.is_admin_expedientes === true;
      
      if (isAdminExp) {
        window.location.href = "/app/expedientes";
        return;
      }

      // listar cédulas del usuario
      // Intentar incluir tipo_documento, pero si no existe la columna, usar select sin ella
      let query = supabase
        .from("cedulas")
        .select("id, owner_user_id, caratula, juzgado, fecha_carga, pdf_path, tipo_documento")
        .eq("owner_user_id", uid)
        .order("fecha_carga", { ascending: false });
      
      const { data: cs, error: cErr } = await query;
      
      // Si el error es porque la columna no existe, intentar sin tipo_documento
      if (cErr && cErr.message?.includes("tipo_documento")) {
        const { data: cs2, error: cErr2 } = await supabase
          .from("cedulas")
          .select("id, owner_user_id, caratula, juzgado, fecha_carga, pdf_path")
          .eq("owner_user_id", uid)
          .order("fecha_carga", { ascending: false });
        
        if (cErr2) {
          setMsg(cErr2.message);
          setLoading(false);
          return;
        }
        // Agregar tipo_documento como null para cada registro
        const csWithNull = (cs2 ?? []).map((c: any) => ({ ...c, tipo_documento: null }));
        setCedulas(csWithNull as Cedula[]);
        setLoading(false);
        return;
      }

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
    let mapped = cedulas.map((c) => {
      const cargaISO = c.fecha_carga || "";
      const dias = cargaISO ? daysSince(cargaISO) : null;
      const diasValidos = dias !== null && !isNaN(dias) && dias >= 0 ? dias : null;
      const sem = diasValidos === null ? ("VERDE" as Semaforo) : semaforoByAge(diasValidos);
      return { ...c, cargaISO, dias: diasValidos, sem };
    });

    // Aplicar filtro de semáforo
    if (semaforoFilter) {
      mapped = mapped.filter((c) => c.sem === semaforoFilter);
    }

    // Aplicar ordenamiento
    if (sortField) {
      mapped.sort((a, b) => {
        let compareA: number;
        let compareB: number;

        if (sortField === "dias") {
          compareA = a.dias ?? -1; // null va al final
          compareB = b.dias ?? -1;
        } else if (sortField === "semaforo") {
          // Rojo = 2, Amarillo = 1, Verde = 0
          const semOrder: Record<Semaforo, number> = { ROJO: 2, AMARILLO: 1, VERDE: 0 };
          compareA = semOrder[a.sem];
          compareB = semOrder[b.sem];
        } else if (sortField === "fecha_carga") {
          // null va al final
          if (!a.cargaISO && !b.cargaISO) return 0;
          if (!a.cargaISO) return 1;
          if (!b.cargaISO) return -1;
          // Usar la fecha completa ISO (con hora, minutos, segundos) para ordenamiento preciso
          // Si la fecha solo tiene YYYY-MM-DD, agregar hora 00:00:00 para mantener compatibilidad
          const dateA = a.cargaISO.length === 10 ? new Date(a.cargaISO + "T00:00:00") : new Date(a.cargaISO);
          const dateB = b.cargaISO.length === 10 ? new Date(b.cargaISO + "T00:00:00") : new Date(b.cargaISO);
          compareA = dateA.getTime();
          compareB = dateB.getTime();
        } else if (sortField === "juzgado") {
          // Ordenamiento alfabético de juzgado (case-insensitive)
          // null va al final
          const juzgadoA = (a.juzgado || "").trim().toUpperCase();
          const juzgadoB = (b.juzgado || "").trim().toUpperCase();
          if (!juzgadoA && !juzgadoB) return 0;
          if (!juzgadoA) return 1;
          if (!juzgadoB) return -1;
          // Comparación alfabética directa
          if (juzgadoA < juzgadoB) return sortDirection === "asc" ? -1 : 1;
          if (juzgadoA > juzgadoB) return sortDirection === "asc" ? 1 : -1;
          return 0;
        } else {
          return 0;
        }

        if (compareA < compareB) return sortDirection === "asc" ? -1 : 1;
        if (compareA > compareB) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }

    return mapped;
  }, [cedulas, sortField, sortDirection, semaforoFilter]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      // Si ya está ordenando por esta columna, invertir la dirección
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Nueva columna, empezar con desc para días, semáforo y fecha_carga (más reciente/crítico primero)
      // Para juzgado, empezar con asc (orden alfabético)
      setSortField(field);
      setSortDirection(field === "juzgado" ? "asc" : "desc");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function abrirArchivo(path: string) {
    setMsg("");
    try {
      // Obtener el token de sesión para autenticación
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setMsg("No estás autenticado");
        return;
      }

      // Usar el endpoint API que sirve el archivo con headers para abrirlo en el navegador
      const url = `/api/open-file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(sessionData.session.access_token)}`;
      
      // Obtener el archivo y crear un blob URL para abrirlo directamente en el navegador
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        setMsg("No se pudo abrir el archivo: " + errorText);
        return;
      }

      // Obtener el Content-Type del response
      const contentType = response.headers.get("Content-Type") || "application/octet-stream";
      
      // Obtener el blob y crear uno nuevo con el tipo MIME explícito
      const blob = await response.blob();
      const typedBlob = new Blob([blob], { type: contentType });
      const blobUrl = URL.createObjectURL(typedBlob);
      
      // Abrir el blob URL en una nueva pestaña - el navegador lo abrirá según el tipo MIME
      // Para PDFs se abrirá en el visor del navegador, para otros tipos dependerá del navegador
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      
      // Limpiar el blob URL después de un tiempo para liberar memoria
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err: any) {
      setMsg("No se pudo abrir el archivo: " + (err?.message || "Error desconocido"));
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
          {currentUserName && (
            <div
              title={currentUserName}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                background: "rgba(96,141,186,.15)",
                border: "1px solid rgba(96,141,186,.35)",
                borderRadius: 10,
                color: "var(--brand-blue-2)",
                fontSize: 14,
                fontWeight: 600,
                height: 40,
                maxWidth: 200,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginRight: 8
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#4ade80",
                  flexShrink: 0,
                  boxShadow: "0 0 0 2px rgba(74, 222, 128, 0.2)"
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {currentUserName}
              </span>
            </div>
          )}
          <Link className="btn primary" href="/app/nueva">
            Nueva
          </Link>
          <button className="btn danger" onClick={logout}>
            Salir
          </button>
        </header>

        <div className="page">
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Semáforo automático por antigüedad desde la carga:
            </span>
            <button
              onClick={() => setSemaforoFilter(semaforoFilter === "VERDE" ? null : "VERDE")}
              style={{
                cursor: "pointer",
                border: semaforoFilter === "VERDE" ? "2px solid rgba(46, 204, 113, 0.8)" : "1px solid rgba(46, 204, 113, 0.35)",
                background: semaforoFilter === "VERDE" ? "rgba(46, 204, 113, 0.25)" : "rgba(46, 204, 113, 0.16)",
                color: "rgba(210, 255, 226, 0.95)",
                padding: "6px 12px",
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: 0.4,
                minWidth: 88,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
              }}
            >
              VERDE
            </button>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>0–29</span>
            <button
              onClick={() => setSemaforoFilter(semaforoFilter === "AMARILLO" ? null : "AMARILLO")}
              style={{
                cursor: "pointer",
                border: semaforoFilter === "AMARILLO" ? "2px solid rgba(241, 196, 15, 0.8)" : "1px solid rgba(241, 196, 15, 0.35)",
                background: semaforoFilter === "AMARILLO" ? "rgba(241, 196, 15, 0.25)" : "rgba(241, 196, 15, 0.14)",
                color: "rgba(255, 246, 205, 0.95)",
                padding: "6px 12px",
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: 0.4,
                minWidth: 88,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
              }}
            >
              AMARILLO
            </button>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>30–59</span>
            <button
              onClick={() => setSemaforoFilter(semaforoFilter === "ROJO" ? null : "ROJO")}
              style={{
                cursor: "pointer",
                border: semaforoFilter === "ROJO" ? "2px solid rgba(231, 76, 60, 0.8)" : "1px solid rgba(231, 76, 60, 0.35)",
                background: semaforoFilter === "ROJO" ? "rgba(231, 76, 60, 0.25)" : "rgba(231, 76, 60, 0.14)",
                color: "rgba(255, 220, 216, 0.95)",
                padding: "6px 12px",
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: 0.4,
                minWidth: 88,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
              }}
            >
              ROJO
            </button>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>60+ días</span>
            {semaforoFilter && (
              <button
                onClick={() => setSemaforoFilter(null)}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,.3)",
                  background: "rgba(255,255,255,.1)",
                  color: "var(--text)",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontWeight: 600,
                  fontSize: 12,
                  transition: "all 0.2s ease",
                }}
              >
                Limpiar filtro
              </button>
            )}
          </div>

          {msg && <div className="error">{msg}</div>}

          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th 
                    className="sortable"
                    style={{ width: 130 }}
                    onClick={() => handleSort("semaforo")}
                    title="Haz clic para ordenar"
                  >
                    Semáforo{" "}
                    <span style={{ opacity: sortField === "semaforo" ? 1 : 0.4 }}>
                      {sortField === "semaforo" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </th>
                  <th>Carátula</th>
                  <th 
                    className="sortable"
                    onClick={() => handleSort("juzgado")}
                    title="Haz clic para ordenar"
                  >
                    Juzgado{" "}
                    <span style={{ opacity: sortField === "juzgado" ? 1 : 0.4 }}>
                      {sortField === "juzgado" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </th>
                  <th 
                    className="sortable"
                    style={{ width: 150 }}
                    onClick={() => handleSort("fecha_carga")}
                    title="Haz clic para ordenar"
                  >
                    Fecha de Carga{" "}
                    <span style={{ opacity: sortField === "fecha_carga" ? 1 : 0.4 }}>
                      {sortField === "fecha_carga" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </th>
                  <th 
                    className="sortable"
                    style={{ width: 80, textAlign: "right" }}
                    onClick={() => handleSort("dias")}
                    title="Haz clic para ordenar"
                  >
                    Días{" "}
                    <span style={{ opacity: sortField === "dias" ? 1 : 0.4 }}>
                      {sortField === "dias" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </th>
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
                      {typeof c.dias === "number" && !isNaN(c.dias) ? c.dias : <span className="muted">—</span>}
                    </td>

                    <td style={{ textAlign: "right" }}>
                      {c.pdf_path ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                          {c.tipo_documento && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "var(--muted)",
                                letterSpacing: 0.5,
                                textTransform: "uppercase",
                              }}
                            >
                              {c.tipo_documento}
                            </span>
                          )}
                          <button className="btn primary" onClick={() => abrirArchivo(c.pdf_path!)}>
                            Abrir
                          </button>
                        </div>
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
