"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { daysSince } from "@/lib/semaforo";

type Expediente = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  estado: string;
  observaciones: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
};

function isoToDDMMAAAA(iso: string | null): string {
  // Maneja formatos ISO: YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss+00:00
  if (!iso || iso.trim() === "") return "";
  
  // Extraer solo la parte de la fecha (primeros 10 caracteres: YYYY-MM-DD)
  const datePart = iso.substring(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  
  return `${m[3]}/${m[2]}/${m[1]}`;
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

type Semaforo = "VERDE" | "AMARILLO" | "ROJO";

function semaforoByAge(diasDesdeModificacion: number): Semaforo {
  if (diasDesdeModificacion >= 60) return "ROJO";
  if (diasDesdeModificacion >= 30) return "AMARILLO";
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

type SortField = "dias" | "semaforo" | "fecha_ultima_modificacion" | null;
type SortDirection = "asc" | "desc";

export default function MisExpedientesPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [expedientes, setExpedientes] = useState<Expediente[]>([]);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [editingFecha, setEditingFecha] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<{
    isSuperadmin: boolean;
    isAdminExpedientes: boolean;
    isAbogado: boolean;
  }>({
    isSuperadmin: false,
    isAdminExpedientes: false,
    isAbogado: false,
  });

  useEffect(() => {
    (async () => {
      setMsg("");

      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

      // Verificar roles del usuario
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_admin_expedientes, is_abogado, is_superadmin")
        .eq("user_id", uid)
        .maybeSingle();
      
      const isAdminExp = !roleErr && roleData?.is_admin_expedientes === true;
      const isAbogado = !roleErr && roleData?.is_abogado === true;
      const isSuperadmin = !roleErr && roleData?.is_superadmin === true;
      
      if (!isAdminExp && !isAbogado) {
        window.location.href = "/app";
        return;
      }

      // Guardar roles para mostrar botones de navegación
      setUserRoles({
        isSuperadmin: isSuperadmin || false,
        isAdminExpedientes: isAdminExp || false,
        isAbogado: isAbogado || false,
      });

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

      // Si es ABOGADO, obtener juzgados asignados y filtrar por ellos
      let juzgadosAsignados: string[] = [];
      if (isAbogado) {
        const { data: juzgadosData, error: juzgadosErr } = await supabase
          .from("user_juzgados")
          .select("juzgado")
          .eq("user_id", uid);
        
        if (!juzgadosErr && juzgadosData) {
          juzgadosAsignados = juzgadosData.map(j => j.juzgado);
        }
      }

      // Construir query según el rol (sin join para evitar errores)
      // Intentar incluir observaciones, pero si no existe la columna, usar select sin ella
      let query;
      if (isAbogado && juzgadosAsignados.length > 0) {
        // ABOGADO: ver todos los expedientes de sus juzgados asignados
        query = supabase
          .from("expedientes")
          .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, created_by_user_id")
          .in("juzgado", juzgadosAsignados)
          .eq("estado", "ABIERTO")
          .order("fecha_ultima_modificacion", { ascending: false });
      } else if (isAdminExp) {
        // ADMIN_EXPEDIENTES: ver todos los expedientes (o solo los propios, según política RLS)
        query = supabase
          .from("expedientes")
          .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, created_by_user_id")
          .eq("estado", "ABIERTO")
          .order("fecha_ultima_modificacion", { ascending: false });
      } else {
        // Fallback: solo propios
        query = supabase
          .from("expedientes")
          .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, created_by_user_id")
          .eq("owner_user_id", uid)
          .eq("estado", "ABIERTO")
          .order("fecha_ultima_modificacion", { ascending: false });
      }

      const { data: exps, error: eErr } = await query;
      
      // Si el error es porque la columna observaciones no existe, intentar sin ella
      let expsData = exps;
      if (eErr && (eErr.message?.includes("observaciones") || eErr.message?.includes("does not exist"))) {
        console.warn(`[Expedientes] Columna observaciones no existe, reintentando sin observaciones`);
        
        let query2;
        if (isAbogado && juzgadosAsignados.length > 0) {
          query2 = supabase
            .from("expedientes")
            .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, created_by_user_id")
            .in("juzgado", juzgadosAsignados)
            .eq("estado", "ABIERTO")
            .order("fecha_ultima_modificacion", { ascending: false });
        } else if (isAdminExp) {
          query2 = supabase
            .from("expedientes")
            .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, created_by_user_id")
            .eq("estado", "ABIERTO")
            .order("fecha_ultima_modificacion", { ascending: false });
        } else {
          query2 = supabase
            .from("expedientes")
            .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, created_by_user_id")
            .eq("owner_user_id", uid)
            .eq("estado", "ABIERTO")
            .order("fecha_ultima_modificacion", { ascending: false });
        }
        
        const { data: exps2, error: eErr2 } = await query2;
        
        if (eErr2) {
          setMsg(`Error al cargar expedientes: ${eErr2.message}`);
          setLoading(false);
          return;
        }
        
        // Establecer observaciones como null para todos
        expsData = (exps2 ?? []).map((e: any) => ({
          ...e,
          observaciones: null
        }));
      } else if (eErr) {
        setMsg(`Error al cargar expedientes: ${eErr.message}`);
        setLoading(false);
        return;
      } else {
        // Si no hubo error, verificar que observaciones se están cargando
        const expsWithObservaciones = (expsData ?? []).filter((e: any) => e.observaciones && e.observaciones.trim());
        console.log(`[Expedientes] Expedientes con observaciones: ${expsWithObservaciones.length}/${expsData?.length || 0}`);
        if (expsData && expsData.length > 0) {
          console.log(`[Expedientes] Primer expediente tiene observaciones:`, expsData[0].observaciones || "null/vacío");
        }
      }

      // Obtener nombres de usuarios que crearon los expedientes
      const userIds = [...new Set((expsData ?? []).map((e: any) => e.created_by_user_id).filter(Boolean))];
      let userNames: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);
        
        if (profiles) {
          userNames = profiles.reduce((acc: Record<string, string>, p: any) => {
            acc[p.id] = p.full_name || p.email || "Sin nombre";
            return acc;
          }, {});
        }
      }
      
      // Procesar expedientes y agregar nombres de usuarios
      const processedExps = (expsData ?? []).map((e: any) => {
        // Asegurarse de que observaciones esté presente
        const observaciones = e.observaciones !== undefined ? e.observaciones : null;
        return {
          ...e,
          observaciones: observaciones || null,
          created_by_name: e.created_by_user_id ? (userNames[e.created_by_user_id] || null) : null,
        };
      });
      
      setExpedientes(processedExps as Expediente[]);
      setLoading(false);
    })();
  }, []);

  const rows = useMemo(() => {
    let mapped = expedientes.map((e) => {
      const fechaModISO = e.fecha_ultima_modificacion || "";
      const dias = fechaModISO ? daysSince(fechaModISO) : null;
      const diasValidos = dias !== null && !isNaN(dias) && dias >= 0 ? dias : null;
      const sem = diasValidos === null ? ("VERDE" as Semaforo) : semaforoByAge(diasValidos);
      return { ...e, fechaModISO, dias: diasValidos, sem };
    });

    // Aplicar ordenamiento
    if (sortField) {
      mapped.sort((a, b) => {
        let compareA: number;
        let compareB: number;

        if (sortField === "dias") {
          compareA = a.dias ?? -1;
          compareB = b.dias ?? -1;
        } else if (sortField === "semaforo") {
          const semOrder: Record<Semaforo, number> = { ROJO: 2, AMARILLO: 1, VERDE: 0 };
          compareA = semOrder[a.sem];
          compareB = semOrder[b.sem];
        } else if (sortField === "fecha_ultima_modificacion") {
          if (!a.fechaModISO && !b.fechaModISO) return 0;
          if (!a.fechaModISO) return 1;
          if (!b.fechaModISO) return -1;
          // Usar getTime() para comparación completa de timestamp
          compareA = new Date(a.fechaModISO).getTime();
          compareB = new Date(b.fechaModISO).getTime();
        } else {
          return 0;
        }

        if (compareA < compareB) return sortDirection === "asc" ? -1 : 1;
        if (compareA > compareB) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }

    return mapped;
  }, [expedientes, sortField, sortDirection]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  }

  async function logout() {
    // Limpiar estado de conexión PJN
    try {
      localStorage.removeItem("pjnConnected");
      localStorage.removeItem("pjnConnectedTimestamp");
    } catch (e) {
      // Ignorar errores de localStorage
    }
    
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function isoToDateInput(iso: string | null): string {
    if (!iso) return "";
    // Convertir ISO a DD/MM/AAAA para input type="text"
    return isoToDDMMAAAA(iso);
  }

  async function updateFechaExpediente(expedienteId: string, nuevaFecha: string) {
    if (!nuevaFecha) {
      setEditingFecha(null);
      return;
    }
    
      setUpdatingId(expedienteId);
    try {
      // Convertir fecha del input (DD/MM/AAAA) a ISO
      const fechaISO = ddmmaaaaToISO(nuevaFecha);
      if (!fechaISO) {
        setMsg("La fecha ingresada no es válida. Use el formato DD/MM/AAAA.");
        setEditingFecha(null);
        setUpdatingId(null);
        return;
      }
      
      const { error } = await supabase
        .from("expedientes")
        .update({ fecha_ultima_modificacion: fechaISO })
        .eq("id", expedienteId);

      if (error) {
        setMsg("Error al actualizar fecha: " + error.message);
        // Recargar expedientes para revertir el cambio visual
        const session = await requireSessionOrRedirect();
        if (session) {
          const uid = session.user.id;
          let query = supabase
            .from("expedientes")
            .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones")
            .eq("owner_user_id", uid)
            .eq("estado", "ABIERTO")
            .order("fecha_ultima_modificacion", { ascending: false });
          
          const { data: exps, error: eErr } = await query;
          
          if (eErr) {
            // Si falla por columna observaciones inexistente, reintentar sin ella
            const errorMsg = eErr.message || String(eErr);
            if (errorMsg.includes("observaciones") || 
                (errorMsg.includes("column") && errorMsg.includes("does not exist"))) {
              const { data: exps2, error: eErr2 } = await supabase
                .from("expedientes")
                .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado")
                .eq("owner_user_id", uid)
                .eq("estado", "ABIERTO")
                .order("fecha_ultima_modificacion", { ascending: false });
              
              if (eErr2) {
                // Si aún falla, intentar sin ordenamiento
                const { data: exps3 } = await supabase
                  .from("expedientes")
                  .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado")
                  .eq("owner_user_id", uid)
                  .eq("estado", "ABIERTO");
                
                if (exps3) {
                  const sorted = exps3.sort((a: any, b: any) => {
                    const dateA = a.fecha_ultima_modificacion ? new Date(a.fecha_ultima_modificacion).getTime() : 0;
                    const dateB = b.fecha_ultima_modificacion ? new Date(b.fecha_ultima_modificacion).getTime() : 0;
                    return dateB - dateA;
                  });
                  const expsWithNull = sorted.map((e: any) => ({ ...e, observaciones: null }));
                  setExpedientes(expsWithNull as Expediente[]);
                }
              } else if (exps2) {
                const expsWithNull = exps2.map((e: any) => ({ ...e, observaciones: null }));
                setExpedientes(expsWithNull as Expediente[]);
              }
            }
          } else if (exps) {
            setExpedientes(exps as Expediente[]);
          }
        }
        setEditingFecha(null);
        return;
      }

      // Actualizar el estado local (el useMemo recalculará días y semáforo automáticamente)
      setExpedientes(prev => prev.map(e => 
        e.id === expedienteId 
          ? { ...e, fecha_ultima_modificacion: fechaISO }
          : e
      ));
      
      setEditingFecha(null);
    } finally {
      setUpdatingId(null);
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
          <h1>Mis Expedientes</h1>
          <div className="spacer" />
          {userRoles.isSuperadmin && (
            <Link className="btn" href="/superadmin" style={{ marginRight: 8 }}>
              DASHBOARD
            </Link>
          )}
          {userRoles.isAbogado && (
            <Link className="btn" href="/app/abogado" style={{ marginRight: 8 }}>
              HOME
            </Link>
          )}
          {(userRoles.isAdminExpedientes || userRoles.isAbogado) && (
            <Link className="btn primary" href="/app/expedientes/nueva" style={{ marginRight: 8 }}>
              Cargar
            </Link>
          )}
          <button className="btn danger" onClick={logout}>
            Salir
          </button>
        </header>

        <div className="page">
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Semáforo automático por antigüedad desde la última modificación:
            </span>
            <SemaforoChip value="VERDE" />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>0–29</span>
            <SemaforoChip value="AMARILLO" />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>30–59</span>
            <SemaforoChip value="ROJO" />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>60+ días</span>
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
                  <th>Juzgado</th>
                  <th 
                    className="sortable"
                    style={{ width: 200 }}
                    onClick={() => handleSort("fecha_ultima_modificacion")}
                    title="Haz clic para ordenar"
                  >
                    Fecha Última Modificación{" "}
                    <span style={{ opacity: sortField === "fecha_ultima_modificacion" ? 1 : 0.4 }}>
                      {sortField === "fecha_ultima_modificacion" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
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
                  <th style={{ width: 170 }}>Expediente</th>
                  <th style={{ width: 150 }}>Cargado por</th>
                  <th style={{ width: 250 }}>Observaciones</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} style={{ verticalAlign: "top" }}>
                    <td>
                      <SemaforoChip value={e.sem} />
                    </td>

                    <td style={{ fontWeight: 650 }}>
                      {e.caratula?.trim() ? e.caratula : <span className="muted">Sin carátula</span>}
                    </td>

                    <td>{e.juzgado?.trim() ? e.juzgado : <span className="muted">—</span>}</td>

                    <td>
                      {editingFecha === e.id ? (
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="text"
                            placeholder="DD/MM/AAAA"
                            defaultValue={isoToDateInput(e.fechaModISO)}
                            onChange={(ev) => {
                              const formatted = formatDateInput(ev.target.value);
                              ev.target.value = formatted;
                            }}
                            onBlur={(ev) => {
                              const nuevaFecha = ev.target.value.trim();
                              if (nuevaFecha && nuevaFecha !== isoToDateInput(e.fechaModISO)) {
                                if (nuevaFecha.length === 10) {
                                  updateFechaExpediente(e.id, nuevaFecha);
                                } else {
                                  setMsg("La fecha debe tener el formato DD/MM/AAAA.");
                                  setEditingFecha(null);
                                }
                              } else {
                                setEditingFecha(null);
                              }
                            }}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") {
                                ev.currentTarget.blur();
                              } else if (ev.key === "Escape") {
                                setEditingFecha(null);
                              }
                            }}
                            autoFocus
                            disabled={updatingId === e.id}
                            maxLength={10}
                            style={{
                              padding: "6px 8px",
                              fontSize: 13,
                              borderRadius: 6,
                              border: "1px solid rgba(255,255,255,.2)",
                              background: "rgba(255,255,255,.08)",
                              color: "var(--text)",
                              outline: "none",
                              width: 140,
                              fontVariantNumeric: "normal",
                            }}
                          />
                          {updatingId === e.id && (
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Guardando...</span>
                          )}
                        </div>
                      ) : (
                        <div 
                          onClick={() => setEditingFecha(e.id)}
                          style={{ 
                            cursor: "pointer",
                            padding: "4px 8px",
                            borderRadius: 4,
                            transition: "background 0.2s ease"
                          }}
                          onMouseEnter={(ev) => {
                            ev.currentTarget.style.background = "rgba(255,255,255,.08)";
                          }}
                          onMouseLeave={(ev) => {
                            ev.currentTarget.style.background = "transparent";
                          }}
                          title="Haz clic para editar la fecha"
                        >
                          {e.fechaModISO ? isoToDDMMAAAA(e.fechaModISO) : <span className="muted">—</span>}
                        </div>
                      )}
                    </td>

                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {typeof e.dias === "number" && !isNaN(e.dias) ? e.dias : <span className="muted">—</span>}
                    </td>

                    <td>
                      {e.numero_expediente?.trim() ? e.numero_expediente : <span className="muted">—</span>}
                    </td>

                    <td>
                      {e.created_by_name ? (
                        <span style={{ fontSize: 13 }}>{e.created_by_name}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    <td style={{ fontSize: 13, maxWidth: 250, wordBreak: "break-word" }}>
                      {e.observaciones?.trim() ? (
                        <div style={{ 
                          padding: "4px 8px",
                          background: "rgba(255,255,255,.04)",
                          borderRadius: 6,
                          border: "1px solid rgba(255,255,255,.08)",
                          lineHeight: 1.5
                        }}>
                          {e.observaciones}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      {isAbogado 
                        ? "No hay expedientes cargados para tus juzgados asignados."
                        : "Todavía no cargaste expedientes."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
