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
  if (!iso || iso.trim() === "") return "";
  const datePart = iso.substring(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
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

export default function AbogadoHomePage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [expedientes, setExpedientes] = useState<Expediente[]>([]);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [userRoles, setUserRoles] = useState<{
    isSuperadmin: boolean;
    isAdminExpedientes: boolean;
    isAbogado: boolean;
  }>({
    isSuperadmin: false,
    isAdminExpedientes: false,
    isAbogado: false,
  });
  const [menuOpen, setMenuOpen] = useState(false);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = () => setMenuOpen(false);
    setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 100);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    (async () => {
      setMsg("");

      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

      // Verificar roles del usuario
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_superadmin, is_admin_expedientes, is_abogado")
        .eq("user_id", uid)
        .maybeSingle();
      
      const isAbogado = !roleErr && roleData?.is_abogado === true;
      const isSuperadmin = !roleErr && (roleData?.is_superadmin === true || roleData?.is_superadmin === "true");
      const isAdminExp = !roleErr && (roleData?.is_admin_expedientes === true || roleData?.is_admin_expedientes === "true");
      
      if (!isAbogado) {
        window.location.href = "/app";
        return;
      }

      // Guardar roles para mostrar botones de navegación (asegurar que se guarda correctamente)
      const rolesToSet = {
        isSuperadmin: Boolean(isSuperadmin),
        isAdminExpedientes: Boolean(isAdminExp),
        isAbogado: Boolean(isAbogado),
      };
      
      setUserRoles(rolesToSet);
      
      // Debug: verificar que se guardó correctamente
      console.log("Roles del usuario:", rolesToSet);

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

      // Obtener juzgados asignados al usuario ABOGADO
      const { data: juzgadosData, error: juzgadosErr } = await supabase
        .from("user_juzgados")
        .select("juzgado")
        .eq("user_id", uid);
      
      if (juzgadosErr || !juzgadosData || juzgadosData.length === 0) {
        setMsg("No tienes juzgados asignados. Contacta al administrador.");
        setLoading(false);
        return;
      }

      const juzgadosAsignados = juzgadosData.map(j => j.juzgado);
      
      // Normalizar juzgados (eliminar espacios extra, normalizar a mayúsculas)
      const juzgadosNormalizados = juzgadosAsignados.map(j => 
        j?.trim().replace(/\s+/g, " ").toUpperCase()
      );

      // Función para normalizar juzgado para comparación
      const normalizarJuzgado = (j: string | null) => {
        if (!j) return "";
        return j.trim().replace(/\s+/g, " ").toUpperCase();
      };

      // Cargar todos los expedientes abiertos y filtrar por juzgados asignados (comparación flexible)
      // Intentar incluir observaciones, pero si no existe la columna, usar select sin ella
      let queryExps = supabase
        .from("expedientes")
        .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, created_by_user_id")
        .eq("estado", "ABIERTO")
        .order("fecha_ultima_modificacion", { ascending: false });
      
      const { data: allExps, error: eErr } = await queryExps;
      
      // Si el error es porque la columna observaciones o created_by_user_id no existe, intentar sin ellas
      let allExpsData = allExps;
      if (eErr && (eErr.message?.includes("observaciones") || eErr.message?.includes("created_by_user_id") || eErr.message?.includes("does not exist"))) {
        const { data: allExps2, error: eErr2 } = await supabase
          .from("expedientes")
          .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado")
          .eq("estado", "ABIERTO")
          .order("fecha_ultima_modificacion", { ascending: false });
        
        if (eErr2) {
          setMsg(`Error al cargar expedientes: ${eErr2.message}`);
          setLoading(false);
          return;
        }
        
        // Establecer observaciones como null para todos
        allExpsData = (allExps2 ?? []).map((e: any) => ({
          ...e,
          observaciones: null
        }));
      } else if (eErr) {
        setMsg(`Error al cargar expedientes: ${eErr.message}`);
        setLoading(false);
        return;
      } else {
        // Si no hubo error, verificar que observaciones se están cargando
        const expsWithObservaciones = (allExpsData ?? []).filter((e: any) => e.observaciones && e.observaciones.trim());
        console.log(`[Abogado] Expedientes con observaciones cargadas: ${expsWithObservaciones.length}/${allExpsData?.length || 0}`);
        if (allExpsData && allExpsData.length > 0) {
          console.log(`[Abogado] Primer expediente tiene observaciones:`, allExpsData[0].observaciones || "null/vacío");
        }
      }
      
      // Filtrar expedientes que coincidan con los juzgados asignados (comparación flexible)
      const exps = allExpsData?.filter((e: any) => {
        const juzgadoNormalizado = normalizarJuzgado(e.juzgado);
        return juzgadosNormalizados.some(jAsignado => {
          // Comparación exacta normalizada
          if (juzgadoNormalizado === jAsignado) return true;
          // Comparación parcial (por si hay pequeñas diferencias en formato)
          const numAsignado = jAsignado.match(/N[°º]\s*(\d+)/i)?.[1];
          const numExpediente = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
          if (numAsignado && numExpediente && numAsignado === numExpediente) {
            // Verificar que ambos contengan "Juzgado Nacional" y el mismo número
            if (jAsignado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
              return true;
            }
          }
          return false;
        }) ?? false;
      }) ?? [];
      
      if (!exps || exps.length === 0) {
        setExpedientes([]);
        setLoading(false);
        return;
      }
      
      // Obtener nombres de usuarios que crearon los expedientes
      const userIds = [...new Set(exps.map((e: any) => e.created_by_user_id).filter(Boolean))];
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
      
      // Verificar observaciones antes de procesar
      const expsWithObservaciones = exps.filter((e: any) => e.observaciones && e.observaciones.trim());
      console.log(`[Abogado] Expedientes con observaciones: ${expsWithObservaciones.length}/${exps.length}`);
      if (exps.length > 0) {
        console.log(`[Abogado] Primer expediente tiene observaciones:`, exps[0].observaciones || "null/vacío");
      }
      
      // Procesar expedientes y agregar nombres de usuarios
      const processedExps = exps.map((e: any) => {
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
    await supabase.auth.signOut();
    window.location.href = "/login";
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
        <header style={{
          background: "linear-gradient(135deg, rgba(0,82,156,.25), rgba(0,82,156,.08))",
          borderBottom: "1px solid rgba(255,255,255,.12)",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          position: "relative"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Menú Hamburguesa */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              style={{
                background: "rgba(255,255,255,.08)",
                border: "1px solid rgba(255,255,255,.16)",
                borderRadius: 8,
                padding: "8px 10px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
                minWidth: 40,
                minHeight: 40
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,.08)";
              }}
            >
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
            </button>

            {/* Menú desplegable */}
            {menuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 24,
                  marginTop: 8,
                  background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))",
                  border: "1px solid rgba(255,255,255,.16)",
                  borderRadius: 12,
                  padding: "12px 0",
                  minWidth: 220,
                  boxShadow: "0 8px 24px rgba(0,0,0,.4)",
                  zIndex: 1000,
                  backdropFilter: "blur(10px)"
                }}
              >
                <Link
                  href="/superadmin"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "block",
                    padding: "12px 20px",
                    color: "var(--text)",
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 600,
                    transition: "background 0.2s ease",
                    borderLeft: "3px solid transparent"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.08)";
                    e.currentTarget.style.borderLeftColor = "var(--brand-blue-2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderLeftColor = "transparent";
                  }}
                >
                  📊 Dashboard SuperAdmin
                </Link>
                <Link
                  href="/superadmin/mis-juzgados"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "block",
                    padding: "12px 20px",
                    color: "var(--text)",
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 600,
                    transition: "background 0.2s ease",
                    borderLeft: "3px solid rgba(96,141,186,1)",
                    background: "rgba(255,255,255,.05)"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.05)";
                  }}
                >
                  📋 Mis Juzgados
                </Link>
                <Link
                  href="/app/expedientes/nueva"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "block",
                    padding: "12px 20px",
                    color: "var(--text)",
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 600,
                    transition: "background 0.2s ease",
                    borderLeft: "3px solid transparent"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.08)";
                    e.currentTarget.style.borderLeftColor = "var(--brand-blue-2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderLeftColor = "transparent";
                  }}
                >
                  ➕ Carga Expedientes
                </Link>
              </div>
            )}

            <img className="logoMini" src="/logo.png" alt="Logo" style={{ width: 32, height: 32 }} />
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "0.2px" }}>
                Expedientes - Mis Juzgados
              </h1>
              <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "rgba(234,243,255,.65)", fontWeight: 400 }}>
                Expedientes de mis juzgados asignados
              </p>
            </div>
          </div>
          <button 
            onClick={logout}
            style={{
              padding: "10px 16px",
              background: "rgba(225,57,64,.15)",
              border: "1px solid rgba(225,57,64,.35)",
              borderRadius: 10,
              color: "#ffcccc",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(225,57,64,.22)";
              e.currentTarget.style.borderColor = "rgba(225,57,64,.45)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(225,57,64,.15)";
              e.currentTarget.style.borderColor = "rgba(225,57,64,.35)";
            }}
          >
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
                    style={{ width: 220 }}
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
                  <th style={{ width: 200 }}>Expediente</th>
                  <th style={{ width: 180 }}>Cargado por</th>
                  <th style={{ width: 400 }}>Observaciones</th>
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
                      {e.fechaModISO ? isoToDDMMAAAA(e.fechaModISO) : <span className="muted">—</span>}
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

                    <td style={{ fontSize: 13, maxWidth: 400 }}>
                      {e.observaciones?.trim() ? (
                        <div style={{ 
                          padding: "8px 10px",
                          background: "rgba(255,255,255,.03)",
                          borderRadius: 8,
                          border: "1px solid rgba(255,255,255,.06)",
                          lineHeight: 1.6,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          color: "rgba(234,243,255,.88)",
                          fontSize: 12.5,
                          letterSpacing: "0.01em"
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
                      No hay expedientes cargados para tus juzgados asignados.
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
